//! Just enough MIME to pull the base64 `e-dekont.html` attachment out of the DKIM-signed body.
//!
//! The guest never scans the ~130 KB body for boundaries: the host *locates* the attachment
//! (`locate_attachment`) and passes the offsets in as an untrusted hint; the guest *verifies* the hint
//! (`attachment_at`) with a handful of comparisons against the body that DKIM just hashed. A hint that
//! points anywhere but at the complete `e-dekont*.html` base64 part is rejected.

use crate::dkim::{header_value, parse_headers, Header};
use crate::text::find_bytes;
use serde::{Deserialize, Serialize};

/// Where the attachment sits in the body (offsets into `dkim::Verified::body`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct AttachmentHint {
    /// offset of the `--boundary` line that opens the part
    pub part_start: u32,
    /// first byte of the base64 payload (right after the part's blank line)
    pub payload_start: u32,
    /// end of the payload (exclusive); followed by CRLF and the next `--boundary`
    pub payload_end: u32,
}

const MAX_PART_HEADER_LEN: usize = 4096;

fn boundary_delim(headers: &[Header]) -> Result<Vec<u8>, String> {
    let ct = header_value(headers, "Content-Type").ok_or("missing Content-Type")?;
    let boundary = param(&ct, "boundary").ok_or("missing multipart boundary")?;
    Ok(format!("--{boundary}").into_bytes())
}

fn part_name(pheaders: &[Header]) -> String {
    let pct = header_value(pheaders, "Content-Type").unwrap_or_default();
    let disp = header_value(pheaders, "Content-Disposition").unwrap_or_default();
    param(&pct, "name").or_else(|| param(&disp, "filename")).unwrap_or_default()
}

fn is_wanted(pheaders: &[Header], name_prefix: &str) -> bool {
    let name = part_name(pheaders);
    name.starts_with(name_prefix) && name.ends_with(".html")
}

/// Host side: find the `<name_prefix>*.html` part (top-level multipart only).
pub fn locate_attachment(headers: &[Header], body: &[u8], name_prefix: &str) -> Option<AttachmentHint> {
    let delim = boundary_delim(headers).ok()?;
    let mut starts = Vec::new();
    let mut pos = 0usize;
    while let Some(i) = find_bytes(&body[pos..], &delim) {
        let at = pos + i;
        if at == 0 || body[at - 1] == b'\n' {
            starts.push(at);
        }
        pos = at + delim.len();
    }
    for w in starts.windows(2) {
        let part_start = w[0];
        let after_delim = part_start + delim.len();
        if !body[after_delim..].starts_with(b"\r\n") {
            continue;
        }
        let hs = after_delim + 2;
        let Some(blank) = find_bytes(&body[hs..w[1]], b"\r\n\r\n") else { continue };
        let payload_start = hs + blank + 4;
        let payload_end = w[1].saturating_sub(2);
        if payload_end < payload_start {
            continue;
        }
        let pheaders = parse_headers(&body[hs..hs + blank + 2]);
        if is_wanted(&pheaders, name_prefix) {
            return Some(AttachmentHint {
                part_start: part_start as u32,
                payload_start: payload_start as u32,
                payload_end: payload_end as u32,
            });
        }
    }
    None
}

/// Guest side: check that `h` delimits exactly one complete top-level part of `body` whose headers name
/// a `<name_prefix>*.html` base64 attachment, and return its raw base64 payload.
pub fn attachment_at<'a>(headers: &[Header], body: &'a [u8], h: AttachmentHint, name_prefix: &str) -> Result<&'a [u8], String> {
    let delim = boundary_delim(headers)?;
    let (ps, pe, end) = (h.part_start as usize, h.payload_start as usize, h.payload_end as usize);
    let bad = |what: &str| Err(format!("attachment hint rejected: {what}"));

    if ps > body.len() || pe > body.len() || end > body.len() || end < pe {
        return bad("out of range");
    }
    if !(ps == 0 || body[ps - 1] == b'\n') {
        return bad("part does not start at a line");
    }
    if !body[ps..].starts_with(&delim) || !body[ps + delim.len()..].starts_with(b"\r\n") {
        return bad("no boundary line at part_start");
    }
    let hs = ps + delim.len() + 2;
    if pe < hs + 4 || pe - hs > MAX_PART_HEADER_LEN || &body[pe - 4..pe] != b"\r\n\r\n" {
        return bad("no blank line before payload_start");
    }
    let hdr = &body[hs..pe - 2];
    if find_bytes(&body[hs..pe - 4], b"\r\n\r\n").is_some() || find_bytes(hdr, &delim).is_some() {
        return bad("payload_start is not the part's first blank line");
    }
    if !body[end..].starts_with(b"\r\n") || !body[end + 2..].starts_with(&delim) {
        return bad("payload_end is not followed by a boundary");
    }
    if find_bytes(&body[pe..end], &delim).is_some() {
        return bad("payload spans a boundary");
    }
    let pheaders = parse_headers(hdr);
    if !is_wanted(&pheaders, name_prefix) {
        return bad("part is not the e-dekont html attachment");
    }
    let cte = header_value(&pheaders, "Content-Transfer-Encoding").unwrap_or_default();
    if !cte.eq_ignore_ascii_case("base64") {
        return bad("attachment is not base64");
    }
    Ok(&body[pe..end])
}

/// Locate + verify + decode (host helpers and tests; the guest uses the hint path).
pub fn extract_html_attachment(headers: &[Header], body: &[u8], name_prefix: &str) -> Result<Vec<u8>, String> {
    let hint = locate_attachment(headers, body, name_prefix).ok_or_else(|| format!("no {name_prefix}*.html attachment found"))?;
    decode_base64_mime(attachment_at(headers, body, hint, name_prefix)?)
}

/// Value of `;key=value` (optionally quoted) in a header like `Content-Type: a/b; name="x"`.
fn param(header: &str, key: &str) -> Option<String> {
    header
        .split(';')
        .skip(1)
        .filter_map(|seg| seg.trim().split_once('='))
        .find(|(k, _)| k.trim().eq_ignore_ascii_case(key))
        .map(|(_, v)| v.trim().trim_matches('"').to_string())
}

const B64_BAD: u32 = 1 << 24;

/// Four pre-shifted tables (`d0[c] = v << 18`, … `d3[c] = v`); bit 24 marks an invalid byte so a quad's
/// OR can be validated with one test.
const fn b64_tables() -> [[u32; 256]; 4] {
    let mut t = [[B64_BAD; 256]; 4];
    let mut i = 0;
    while i < 64 {
        let c = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"[i] as usize;
        t[0][c] = (i as u32) << 18;
        t[1][c] = (i as u32) << 12;
        t[2][c] = (i as u32) << 6;
        t[3][c] = i as u32;
        i += 1;
    }
    t
}
const B64: [[u32; 256]; 4] = b64_tables();

#[inline(always)]
fn b64_quad(q: &[u8]) -> u32 {
    B64[0][q[0] as usize] | B64[1][q[1] as usize] | B64[2][q[2] as usize] | B64[3][q[3] as usize]
}

/// Standard base64 with MIME line wrapping (CR/LF/space/tab ignored, `=` padding only at the end).
/// Complete 76-char lines are decoded 4 chars at a time without per-byte checks; anything else goes
/// through the general loop. About a quarter of the zkVM cycles of the `base64` crate.
pub fn decode_base64_mime(data: &[u8]) -> Result<Vec<u8>, String> {
    let mut out = vec![0u8; data.len() / 4 * 3 + 3];
    let mut o = 0usize;
    let mut i = 0usize;
    let mut acc: u32 = 0;
    let mut n: u32 = 0;
    let mut pad = 0u32;
    // MIME wraps at a fixed width (Ziraat: 68, RFC 2045 max 76). Learn it from the first line; every
    // later line of exactly that width followed by the same line ending takes the fast path.
    let (line_len, eol_len) = match data.iter().position(|&c| c == b'\n') {
        Some(nl) if nl > 0 && data[nl - 1] == b'\r' && (nl - 1) % 4 == 0 => (nl - 1, 2),
        Some(nl) if nl % 4 == 0 => (nl, 1),
        _ => (0, 0),
    };
    let stride = line_len + eol_len;
    while i < data.len() {
        if line_len > 0
            && n == 0
            && pad == 0
            && i + stride <= data.len()
            && data[i + stride - 1] == b'\n'
            && (eol_len == 1 || data[i + line_len] == b'\r')
        {
            let mut ok = 0u32;
            let o0 = o;
            for q in data[i..i + line_len].chunks_exact(4) {
                let v = b64_quad(q);
                ok |= v;
                out[o] = (v >> 16) as u8;
                out[o + 1] = (v >> 8) as u8;
                out[o + 2] = v as u8;
                o += 3;
            }
            if ok & B64_BAD == 0 {
                i += stride;
                continue;
            }
            o = o0; // a bad byte (or padding) in this line: redo it byte by byte below
        }
        let c = data[i];
        i += 1;
        match c {
            b'\r' | b'\n' | b' ' | b'\t' => continue,
            b'=' => {
                pad += 1;
                continue;
            }
            _ => {}
        }
        let v = B64[3][c as usize];
        if v & B64_BAD != 0 || pad > 0 {
            return Err(format!("base64: invalid byte 0x{c:02x}"));
        }
        acc = (acc << 6) | v;
        n += 1;
        if n == 4 {
            out[o] = (acc >> 16) as u8;
            out[o + 1] = (acc >> 8) as u8;
            out[o + 2] = acc as u8;
            o += 3;
            acc = 0;
            n = 0;
        }
    }
    match n {
        0 => {}
        2 => {
            out[o] = (acc >> 4) as u8;
            o += 1;
        }
        3 => {
            out[o] = (acc >> 10) as u8;
            out[o + 1] = (acc >> 2) as u8;
            o += 2;
        }
        _ => return Err("base64: truncated".into()),
    }
    if pad > 2 {
        return Err("base64: bad padding".into());
    }
    out.truncate(o);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;

    const BOUNDARY: &str = "----boundary_1_abc";

    fn body(payload_b64: &str) -> Vec<u8> {
        format!(
            "--{b}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\nPGh0bWw+aW5saW5lPC9odG1sPg==\r\n\
--{b}\r\nContent-Type: application/octet-stream; name=\"e-dekont.html\"\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment\r\n\r\n{p}\r\n\
--{b}--\r\n",
            b = BOUNDARY,
            p = payload_b64
        )
        .into_bytes()
    }

    fn headers() -> Vec<Header> {
        parse_headers(format!("Content-Type: multipart/mixed; boundary=\"{BOUNDARY}\"\r\n").as_bytes())
    }

    fn wrap76(b64: &str) -> String {
        b64.as_bytes().chunks(76).map(|c| std::str::from_utf8(c).unwrap()).collect::<Vec<_>>().join("\r\n")
    }

    #[test]
    fn locate_verify_decode_roundtrip() {
        let html = "<html><body><table><tr><td>İşlem Tutarı</td><td>:</td><td>1.681,50 TRY</td></tr></table></body></html>".repeat(40);
        let b64 = wrap76(&base64::engine::general_purpose::STANDARD.encode(html.as_bytes()));
        let body = body(&b64);
        let h = headers();
        let hint = locate_attachment(&h, &body, "e-dekont").expect("located");
        let payload = attachment_at(&h, &body, hint, "e-dekont").expect("verified");
        assert_eq!(decode_base64_mime(payload).unwrap(), html.as_bytes());
        assert_eq!(extract_html_attachment(&h, &body, "e-dekont").unwrap(), html.as_bytes());

        // tampered hints are rejected
        let reject = |hh: AttachmentHint| attachment_at(&h, &body, hh, "e-dekont").is_err();
        assert!(reject(AttachmentHint { payload_start: hint.payload_start + 4, ..hint }), "payload_start moved");
        assert!(reject(AttachmentHint { payload_end: hint.payload_end - 1, ..hint }), "payload_end moved");
        assert!(reject(AttachmentHint { part_start: hint.part_start + 1, ..hint }), "part_start moved");
        assert!(reject(AttachmentHint { part_start: 0, payload_start: 0, payload_end: 0 }), "zero");
        // the inline html part (first part) is not the attachment
        let first_payload = find_bytes(&body, b"PGh0bWw+").unwrap();
        let first_end = first_payload + "PGh0bWw+aW5saW5lPC9odG1sPg==".len();
        assert!(reject(AttachmentHint { part_start: 0, payload_start: first_payload as u32, payload_end: first_end as u32 }), "inline part");
        // a sub-range of the attachment payload is not a complete part
        assert!(reject(AttachmentHint { payload_start: hint.payload_start + 76 + 2, ..hint }), "sub-range");
    }

    #[test]
    fn base64_matches_reference() {
        let engine = base64::engine::general_purpose::STANDARD;
        for len in [0usize, 1, 2, 3, 4, 5, 57, 58, 100, 1000, 4097] {
            let data: Vec<u8> = (0..len).map(|i| (i * 31 % 251) as u8).collect();
            let enc = engine.encode(&data);
            assert_eq!(decode_base64_mime(enc.as_bytes()).unwrap(), data, "len {len}");
            assert_eq!(decode_base64_mime(wrap76(&enc).as_bytes()).unwrap(), data, "wrapped len {len}");
        }
        assert!(decode_base64_mime(b"ab$d").is_err());
        assert!(decode_base64_mime(b"a===").is_err());
        assert!(decode_base64_mime(b"abc=abcd").is_err(), "padding in the middle");
    }
}
