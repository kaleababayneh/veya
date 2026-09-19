//! Minimal, dependency-light DKIM (RFC 6376) verification for rsa-sha256 signatures.
//! Supports simple/relaxed canonicalization for both headers and body, and the `l=` tag.

use rsa::{pkcs1v15::Pkcs1v15Sign, pkcs8::DecodePublicKey, RsaPublicKey};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DkimError {
    NoSignature,
    UnsupportedAlgorithm(String),
    MalformedSignature(String),
    BodyHashMismatch,
    BadPublicKey,
    SignatureInvalid,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Canon {
    Simple,
    Relaxed,
}

/// A raw header field as it appears in the message (folded lines joined with CRLF).
#[derive(Debug, Clone)]
pub struct Header {
    pub name: String,
    /// raw value bytes after the colon, folding preserved, no trailing CRLF
    pub raw_value: Vec<u8>,
    /// full raw field (`Name: value` with folding), no trailing CRLF
    pub raw_field: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct Verified<'a> {
    pub domain: String,
    pub selector: String,
    pub headers: Vec<Header>,
    /// message body (after the blank line), borrowed from the input — which must already be CRLF
    /// (see [`normalized`]); a bare-LF body simply fails the body hash
    pub body: &'a [u8],
}

struct Sig {
    domain: String,
    selector: String,
    algorithm: String,
    canon_header: Canon,
    canon_body: Canon,
    signed_headers: Vec<String>,
    body_hash: Vec<u8>,
    signature: Vec<u8>,
    body_length: Option<usize>,
}

/// Split at the first blank line: (header block incl. its final CRLF, body). No copies, no
/// normalization — the guest gets CRLF input from the host (`normalized`); a bare-LF message would
/// only fail its DKIM body hash, never verify wrongly.
pub fn split_message(eml: &[u8]) -> (&[u8], &[u8]) {
    match find(eml, b"\r\n\r\n") {
        Some(i) => (&eml[..i + 2], &eml[i + 4..]),
        None => (eml, &[]),
    }
}

/// Host side: CRLF-normalize an `.eml` saved with bare LF line endings (scans the whole file — do it
/// once on the host, not in the guest).
pub fn normalized(eml: &[u8]) -> std::borrow::Cow<'_, [u8]> {
    if has_bare_lf(eml) {
        std::borrow::Cow::Owned(normalize_crlf(eml))
    } else {
        std::borrow::Cow::Borrowed(eml)
    }
}

fn has_bare_lf(b: &[u8]) -> bool {
    b.iter().enumerate().any(|(i, &c)| c == b'\n' && (i == 0 || b[i - 1] != b'\r'))
}

pub fn parse_headers(block: &[u8]) -> Vec<Header> {
    let mut out: Vec<Header> = Vec::new();
    let mut cur: Option<Vec<u8>> = None;
    for line in block.split(|&b| b == b'\n') {
        let line = line.strip_suffix(b"\r").unwrap_or(line);
        if line.is_empty() {
            continue;
        }
        if let Some(c) = cur.as_mut().filter(|_| line[0] == b' ' || line[0] == b'\t') {
            c.extend_from_slice(b"\r\n");
            c.extend_from_slice(line);
        } else {
            if let Some(c) = cur.take() {
                push_header(&mut out, c);
            }
            cur = Some(line.to_vec());
        }
    }
    if let Some(c) = cur.take() {
        push_header(&mut out, c);
    }
    out
}

fn push_header(out: &mut Vec<Header>, raw: Vec<u8>) {
    if let Some(colon) = raw.iter().position(|&b| b == b':') {
        let name = String::from_utf8_lossy(&raw[..colon]).trim().to_string();
        out.push(Header {
            name,
            raw_value: raw[colon + 1..].to_vec(),
            raw_field: raw,
        });
    }
}

/// Verify the first DKIM-Signature that validates with `pubkey_der`.
pub fn verify<'a>(eml: &'a [u8], pubkey_der: &[u8]) -> Result<Verified<'a>, DkimError> {
    let (hblock, body) = split_message(eml);
    let headers = parse_headers(hblock);
    let pk = RsaPublicKey::from_public_key_der(pubkey_der).map_err(|_| DkimError::BadPublicKey)?;

    let mut last_err = DkimError::NoSignature;
    for (idx, h) in headers.iter().enumerate() {
        if !h.name.eq_ignore_ascii_case("DKIM-Signature") {
            continue;
        }
        match verify_one(&headers, idx, body, &pk) {
            Ok(sig) => {
                return Ok(Verified {
                    domain: sig.domain,
                    selector: sig.selector,
                    headers,
                    body,
                })
            }
            Err(e) => last_err = e,
        }
    }
    Err(last_err)
}

fn verify_one(headers: &[Header], sig_idx: usize, body: &[u8], pk: &RsaPublicKey) -> Result<Sig, DkimError> {
    let sig_hdr = &headers[sig_idx];
    let sig = parse_signature(&String::from_utf8_lossy(&sig_hdr.raw_value))?;
    if !sig.algorithm.eq_ignore_ascii_case("rsa-sha256") {
        return Err(DkimError::UnsupportedAlgorithm(sig.algorithm.clone()));
    }

    // body hash — simple canonicalization is hashed in place (no copy of the ~100 KB body)
    let body_digest: [u8; 32] = match (sig.canon_body, sig.body_length) {
        (Canon::Simple, None) => {
            let end = simple_body_end(body);
            let mut h = Sha256::new();
            h.update(&body[..end]);
            if end == 0 || !body[..end].ends_with(b"\r\n") {
                h.update(b"\r\n");
            }
            h.finalize().into()
        }
        (canon, l) => {
            let mut canon_body = canonicalize_body(body, canon);
            if let Some(l) = l {
                canon_body.truncate(l);
            }
            Sha256::digest(&canon_body).into()
        }
    };
    if body_digest[..] != sig.body_hash[..] {
        return Err(DkimError::BodyHashMismatch);
    }

    // header hash: h= names in order, each taken from the bottom-most unused instance
    let mut used = vec![false; headers.len()];
    used[sig_idx] = true;
    let mut data: Vec<u8> = Vec::new();
    for want in &sig.signed_headers {
        let pos = headers
            .iter()
            .enumerate()
            .rev()
            .find(|(i, h)| !used[*i] && h.name.eq_ignore_ascii_case(want));
        if let Some((i, h)) = pos {
            used[i] = true;
            data.extend_from_slice(&canonicalize_header(&h.name, &h.raw_value, sig.canon_header));
            data.extend_from_slice(b"\r\n");
        }
    }
    let stripped = strip_b_tag(&sig_hdr.raw_value);
    data.extend_from_slice(&canonicalize_header(&sig_hdr.name, &stripped, sig.canon_header));

    let digest = Sha256::digest(&data);
    pk.verify(Pkcs1v15Sign::new::<Sha256>(), &digest, &sig.signature)
        .map_err(|_| DkimError::SignatureInvalid)?;
    Ok(sig)
}

fn parse_signature(v: &str) -> Result<Sig, DkimError> {
    let mut domain = None;
    let mut selector = None;
    let mut algorithm = None;
    let mut canon = (Canon::Simple, Canon::Simple);
    let mut signed_headers = Vec::new();
    let mut body_hash = None;
    let mut signature = None;
    let mut body_length = None;
    for tag in v.split(';') {
        let tag = tag.trim();
        if tag.is_empty() {
            continue;
        }
        let (k, val) = tag
            .split_once('=')
            .ok_or_else(|| DkimError::MalformedSignature(tag.to_string()))?;
        let k = k.trim();
        let val: String = val.chars().filter(|c| !c.is_whitespace()).collect();
        match k {
            "v" => {
                if val != "1" {
                    return Err(DkimError::MalformedSignature("v".into()));
                }
            }
            "d" => domain = Some(val),
            "s" => selector = Some(val),
            "a" => algorithm = Some(val),
            "c" => {
                let (h, b) = val.split_once('/').unwrap_or((val.as_str(), "simple"));
                canon = (parse_canon(h)?, parse_canon(b)?);
            }
            "h" => signed_headers = val.split(':').map(|s| s.to_string()).collect(),
            "bh" => body_hash = Some(b64(&val)?),
            "b" => signature = Some(b64(&val)?),
            "l" => body_length = Some(val.parse().map_err(|_| DkimError::MalformedSignature("l".into()))?),
            _ => {}
        }
    }
    Ok(Sig {
        domain: domain.ok_or(DkimError::MalformedSignature("d".into()))?,
        selector: selector.ok_or(DkimError::MalformedSignature("s".into()))?,
        algorithm: algorithm.ok_or(DkimError::MalformedSignature("a".into()))?,
        canon_header: canon.0,
        canon_body: canon.1,
        signed_headers,
        body_hash: body_hash.ok_or(DkimError::MalformedSignature("bh".into()))?,
        signature: signature.ok_or(DkimError::MalformedSignature("b".into()))?,
        body_length,
    })
}

fn parse_canon(s: &str) -> Result<Canon, DkimError> {
    match s {
        "simple" => Ok(Canon::Simple),
        "relaxed" => Ok(Canon::Relaxed),
        other => Err(DkimError::MalformedSignature(format!("c={other}"))),
    }
}

fn b64(s: &str) -> Result<Vec<u8>, DkimError> {
    crate::mime::decode_base64_mime(s.as_bytes()).map_err(|_| DkimError::MalformedSignature("base64".into()))
}

/// Remove the value of the `b=` tag, keeping every other byte (whitespace and folding included)
/// so both simple and relaxed canonicalization see the header exactly as the signer did.
fn strip_b_tag(raw_value: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(raw_value.len());
    for (i, seg) in raw_value.split(|&c| c == b';').enumerate() {
        if i > 0 {
            out.push(b';');
        }
        match b_tag_value_start(seg) {
            Some(eq) => out.extend_from_slice(&seg[..=eq]),
            None => out.extend_from_slice(seg),
        }
    }
    out
}

/// If `seg` is the `b=` tag (`WSP* "b" WSP* "="`), return the index of its `=`.
fn b_tag_value_start(seg: &[u8]) -> Option<usize> {
    let is_wsp = |c: &u8| matches!(c, b' ' | b'\t' | b'\r' | b'\n');
    let name = seg.iter().position(|c| !is_wsp(c))?;
    if seg[name] != b'b' {
        return None;
    }
    let eq = name + 1 + seg[name + 1..].iter().position(|c| !is_wsp(c))?;
    (seg[eq] == b'=').then_some(eq)
}

/// `(selector, domain)` of the first DKIM-Signature header, without verifying anything.
pub fn selector_and_domain(eml: &[u8]) -> Option<(String, String)> {
    let (h, _) = split_message(eml);
    let headers = parse_headers(&h);
    let raw = headers.iter().find(|h| h.name.eq_ignore_ascii_case("DKIM-Signature"))?;
    let sig = parse_signature(&String::from_utf8_lossy(&raw.raw_value)).ok()?;
    Some((sig.selector, sig.domain))
}

fn canonicalize_header(name: &str, raw_value: &[u8], canon: Canon) -> Vec<u8> {
    match canon {
        Canon::Simple => {
            let mut v = name.as_bytes().to_vec();
            v.push(b':');
            v.extend_from_slice(raw_value);
            v
        }
        Canon::Relaxed => {
            let mut v = name.to_ascii_lowercase().into_bytes();
            v.push(b':');
            // unfold, collapse WSP runs, trim
            let mut val: Vec<u8> = Vec::with_capacity(raw_value.len());
            let mut in_ws = false;
            for &c in raw_value {
                if c == b'\r' || c == b'\n' {
                    continue;
                }
                if c == b' ' || c == b'\t' {
                    in_ws = true;
                } else {
                    if in_ws && !val.is_empty() {
                        val.push(b' ');
                    }
                    in_ws = false;
                    val.push(c);
                }
            }
            v.extend_from_slice(&val);
            v
        }
    }
}

/// Length of `body` after removing trailing empty lines (simple canonicalization, RFC 6376 §3.4.3).
fn simple_body_end(body: &[u8]) -> usize {
    let mut end = body.len();
    while end >= 4 && &body[end - 4..end] == b"\r\n\r\n" {
        end -= 2;
    }
    end
}

fn canonicalize_body(body: &[u8], canon: Canon) -> Vec<u8> {
    let mut out: Vec<u8> = match canon {
        Canon::Simple => body.to_vec(),
        Canon::Relaxed => {
            let mut o = Vec::with_capacity(body.len());
            for line in body.split(|&b| b == b'\n') {
                let line = line.strip_suffix(b"\r").unwrap_or(line);
                let mut l: Vec<u8> = Vec::with_capacity(line.len());
                let mut in_ws = false;
                for &c in line {
                    if c == b' ' || c == b'\t' {
                        in_ws = true;
                    } else {
                        if in_ws {
                            l.push(b' ');
                        }
                        in_ws = false;
                        l.push(c);
                    }
                }
                o.extend_from_slice(&l);
                o.extend_from_slice(b"\r\n");
            }
            // split() yields a trailing empty piece when body ends with \n; drop that extra CRLF
            if body.ends_with(b"\n") && o.ends_with(b"\r\n\r\n") {
                o.truncate(o.len() - 2);
            }
            o
        }
    };
    while out.ends_with(b"\r\n\r\n") {
        out.truncate(out.len() - 2);
    }
    if out.is_empty() {
        if canon == Canon::Simple {
            out.extend_from_slice(b"\r\n");
        }
    } else if !out.ends_with(b"\r\n") {
        out.extend_from_slice(b"\r\n");
    }
    out
}

fn normalize_crlf(b: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(b.len() + 16);
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'\r' && i + 1 < b.len() && b[i + 1] == b'\n' {
            out.extend_from_slice(b"\r\n");
            i += 2;
        } else if b[i] == b'\n' {
            out.extend_from_slice(b"\r\n");
            i += 1;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    out
}

pub fn find(h: &[u8], n: &[u8]) -> Option<usize> {
    crate::text::find_bytes(h, n)
}

pub fn header_value(headers: &[Header], name: &str) -> Option<String> {
    headers
        .iter()
        .find(|h| h.name.eq_ignore_ascii_case(name))
        .map(|h| {
            String::from_utf8_lossy(&h.raw_value)
                .replace("\r\n", "")
                .trim()
                .to_string()
        })
}

/// Domain part of the (first) address in a header like `From: Name <user@domain>`.
pub fn header_address_domain(headers: &[Header], name: &str) -> Option<String> {
    let v = header_value(headers, name)?;
    let addr = match (v.rfind('<'), v.rfind('>')) {
        (Some(a), Some(b)) if b > a => &v[a + 1..b],
        _ => v.trim(),
    };
    addr.rsplit_once('@').map(|(_, d)| d.trim().to_ascii_lowercase())
}
