//! Just enough MIME to pull the base64 HTML attachment (e-dekont.html) out of the signed body.

use crate::dkim::{find, header_value, parse_headers, Header};
use base64::Engine;

/// The HTML attachment whose filename starts with `name_prefix` (falls back to the first HTML attachment).
pub fn extract_html_attachment(headers: &[Header], body: &[u8], name_prefix: &str) -> Result<Vec<u8>, String> {
    let ct = header_value(headers, "Content-Type").ok_or("missing Content-Type")?;
    let boundary = param(&ct, "boundary").ok_or("missing multipart boundary")?;
    let delim = format!("--{boundary}");
    let mut candidate: Option<Vec<u8>> = None;
    for part in split_parts(body, delim.as_bytes()) {
        let (ph, pb) = split_part(&part);
        let pheaders = parse_headers(&ph);
        let pct = header_value(&pheaders, "Content-Type").unwrap_or_default();
        let disp = header_value(&pheaders, "Content-Disposition").unwrap_or_default();
        let name = param(&pct, "name")
            .or_else(|| param(&disp, "filename"))
            .unwrap_or_default();
        let is_statement = name.starts_with(name_prefix) && name.ends_with(".html");
        let is_html_attachment = pct.to_ascii_lowercase().starts_with("text/html")
            && disp.to_ascii_lowercase().contains("attachment");
        if is_statement || (is_html_attachment && candidate.is_none()) {
            let cte = header_value(&pheaders, "Content-Transfer-Encoding")
                .unwrap_or_default()
                .to_ascii_lowercase();
            let decoded = decode_transfer(&pb, &cte)?;
            if is_statement {
                return Ok(decoded);
            }
            candidate = Some(decoded);
        }
    }
    candidate.ok_or_else(|| format!("no {name_prefix}*.html attachment found"))
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

fn split_parts(body: &[u8], delim: &[u8]) -> Vec<Vec<u8>> {
    let mut parts = Vec::new();
    let mut pos = 0usize;
    // find each occurrence of the delimiter at line start
    let mut starts = Vec::new();
    while let Some(i) = find(&body[pos..], delim) {
        let at = pos + i;
        if at == 0 || body[at - 1] == b'\n' {
            starts.push(at);
        }
        pos = at + delim.len();
    }
    for w in starts.windows(2) {
        let s = w[0] + delim.len();
        // the delimiter line ends with CRLF (or is the closing "--")
        let line_end = find(&body[s..], b"\r\n").map(|p| s + p + 2).unwrap_or(s);
        let content_end = w[1].saturating_sub(2); // strip CRLF preceding the next delimiter
        if line_end <= content_end && !body[s..].starts_with(b"--") {
            parts.push(body[line_end..content_end].to_vec());
        }
    }
    parts
}

fn split_part(part: &[u8]) -> (Vec<u8>, Vec<u8>) {
    match find(part, b"\r\n\r\n") {
        Some(i) => (part[..i + 2].to_vec(), part[i + 4..].to_vec()),
        None => (Vec::new(), part.to_vec()),
    }
}

fn decode_transfer(data: &[u8], cte: &str) -> Result<Vec<u8>, String> {
    match cte {
        "base64" => decode_base64_lines(data).or_else(|_| {
            // non-standard wrapping: fall back to stripping all whitespace first
            let clean: Vec<u8> = data.iter().copied().filter(|c| !c.is_ascii_whitespace()).collect();
            base64::engine::general_purpose::STANDARD
                .decode(&clean)
                .map_err(|e| format!("base64: {e}"))
        }),
        "quoted-printable" => Ok(decode_qp(data)),
        _ => Ok(data.to_vec()),
    }
}

/// MIME base64 is wrapped at 76 chars, so every line decodes on its own; this avoids a full copy
/// of the attachment just to strip line breaks.
fn decode_base64_lines(data: &[u8]) -> Result<Vec<u8>, String> {
    let engine = base64::engine::general_purpose::STANDARD;
    let mut out = Vec::with_capacity(data.len() / 4 * 3);
    for line in data.split(|&b| b == b'\n') {
        let line = line.strip_suffix(b"\r").unwrap_or(line).trim_ascii();
        if line.is_empty() {
            continue;
        }
        engine.decode_vec(line, &mut out).map_err(|e| format!("base64: {e}"))?;
    }
    Ok(out)
}

fn decode_qp(data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(data.len());
    let mut i = 0;
    while i < data.len() {
        if data[i] == b'=' {
            if data[i + 1..].starts_with(b"\r\n") {
                i += 3;
                continue;
            }
            if i + 2 < data.len() {
                if let Ok(v) = u8::from_str_radix(std::str::from_utf8(&data[i + 1..i + 3]).unwrap_or("zz"), 16) {
                    out.push(v);
                    i += 3;
                    continue;
                }
            }
        }
        out.push(data[i]);
        i += 1;
    }
    out
}
