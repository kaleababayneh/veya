//! Small text utilities shared by the parsers (Turkish number/date formats, IBAN search, HTML text).
//! Everything here runs inside the zkVM guest, so it is written as single passes over bytes.

/// `dd.mm.yyyy` or `dd/mm/yyyy` -> yyyymmdd
pub fn parse_date_dmy(s: &str) -> Option<u64> {
    let mut it = s.trim().split(['.', '/']);
    let d: u64 = it.next()?.trim().parse().ok()?;
    let m: u64 = it.next()?.trim().parse().ok()?;
    let y: u64 = it.next()?.trim().parse().ok()?;
    if !(1..=31).contains(&d) || !(1..=12).contains(&m) || !(2000..=2200).contains(&y) {
        return None;
    }
    Some(y * 10_000 + m * 100 + d)
}

/// `-1.681,50` -> -168150 kuruş (Turkish thousands `.` and decimal `,`)
pub fn parse_amount(s: &str) -> Option<i64> {
    let s = s.trim();
    let neg = s.starts_with('-');
    let s = s.trim_start_matches(['-', '+']);
    let (int, frac) = s.split_once(',').unwrap_or((s, "00"));
    if int.is_empty() || !int.chars().all(|c| c.is_ascii_digit() || c == '.') {
        return None;
    }
    let int: i64 = int.replace('.', "").parse().ok()?;
    let frac: i64 = format!("{:0<2}", frac).get(..2)?.parse().ok()?;
    let v = int * 100 + frac;
    Some(if neg { -v } else { v })
}

/// First `TR` + 24 digits (spaces inside tolerated), normalized without spaces.
pub fn find_iban(s: &str) -> Option<String> {
    find_ibans(s).into_iter().next()
}

/// All distinct Turkish IBANs in `s`, in order of appearance.
pub fn find_ibans(s: &str) -> Vec<String> {
    let b = s.as_bytes();
    let mut out: Vec<String> = Vec::new();
    let mut i = 0;
    while i + 2 <= b.len() {
        if &b[i..i + 2] == b"TR" {
            let mut digits = String::with_capacity(24);
            let mut j = i + 2;
            while j < b.len() && digits.len() < 24 {
                match b[j] {
                    c if c.is_ascii_digit() => digits.push(c as char),
                    b' ' => {}
                    _ => break,
                }
                j += 1;
            }
            if digits.len() == 24 {
                let iban = format!("TR{digits}");
                if !out.contains(&iban) {
                    out.push(iban);
                }
                i = j;
                continue;
            }
        }
        i += 1;
    }
    out
}

/// First occurrence of `needle` in `hay`. A first-byte filter plus a slice compare; `str::find`'s
/// two-way searcher and `windows().position()` both cost several times more per byte in the zkVM.
pub fn find_bytes(hay: &[u8], needle: &[u8]) -> Option<usize> {
    let n = needle.len();
    if n == 0 {
        return Some(0);
    }
    if hay.len() < n {
        return None;
    }
    let first = needle[0];
    let last_start = hay.len() - n;
    let mut i = 0;
    while i <= last_start {
        if hay[i] == first && &hay[i..i + n] == needle {
            return Some(i);
        }
        i += 1;
    }
    None
}

/// Tags removed, common entities decoded, whitespace (incl. NBSP) collapsed to single spaces, trimmed.
/// One pass, one allocation.
pub fn clean_html_text(s: &str) -> String {
    let b = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(b.len());
    let mut in_tag = false;
    let mut pending_space = false;
    let mut i = 0;
    while i < b.len() {
        let c = b[i];
        if in_tag {
            if c == b'>' {
                in_tag = false;
                pending_space = true;
            }
            i += 1;
            continue;
        }
        let (emit, adv): (&[u8], usize) = match c {
            b'<' => {
                in_tag = true;
                (b"", 1)
            }
            b'&' => {
                let rest = &b[i..];
                if rest.starts_with(b"&amp;") {
                    (b"&", 5)
                } else if rest.starts_with(b"&lt;") {
                    (b"<", 4)
                } else if rest.starts_with(b"&gt;") {
                    (b">", 4)
                } else if rest.starts_with(b"&quot;") {
                    (b"\"", 6)
                } else if rest.starts_with(b"&#39;") {
                    (b"'", 5)
                } else if rest.starts_with(b"&nbsp;") {
                    pending_space = true;
                    (b"", 6)
                } else {
                    (b"&", 1)
                }
            }
            b' ' | b'\t' | b'\n' | b'\r' | 0x0b | 0x0c => {
                pending_space = true;
                (b"", 1)
            }
            0xC2 if b.get(i + 1) == Some(&0xA0) => {
                // U+00A0 no-break space
                pending_space = true;
                (b"", 2)
            }
            _ => (&b[i..i + 1], 1),
        };
        if !emit.is_empty() {
            if pending_space && !out.is_empty() {
                out.push(b' ');
            }
            pending_space = false;
            out.extend_from_slice(emit);
        }
        i += adv;
    }
    // only ASCII bytes were interpreted; multi-byte UTF-8 sequences were copied whole
    String::from_utf8(out).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn amounts_and_dates() {
        assert_eq!(parse_amount("-1.681,50"), Some(-168150));
        assert_eq!(parse_amount("3.200,00"), Some(320000));
        assert_eq!(parse_amount("-0,02"), Some(-2));
        assert_eq!(parse_amount("abc"), None);
        assert_eq!(parse_date_dmy("05.09.2026"), Some(20260905));
        assert_eq!(parse_date_dmy("08/09/2026"), Some(20260908));
        assert_eq!(parse_date_dmy("32.09.2026"), None);
    }

    #[test]
    fn iban_search() {
        assert_eq!(find_iban("IBAN : TR33 0006 1005 1978 6457 8413 26"), Some("TR330006100519786457841326".into()));
        assert_eq!(find_iban("TRY 12"), None);
        assert_eq!(find_ibans("a TR120000000000000000000001 b TR120000000000000000000001 c TR330006100519786457841326").len(), 2);
    }

    #[test]
    fn find_bytes_basic() {
        assert_eq!(find_bytes(b"hello world", b"world"), Some(6));
        assert_eq!(find_bytes(b"hello", b""), Some(0));
        assert_eq!(find_bytes(b"hello", b"hello!"), None);
        assert_eq!(find_bytes(b"aaab", b"ab"), Some(2));
        assert_eq!(find_bytes(b"<tr><td>x</td></tr>", b"</tr>"), Some(14));
    }

    #[test]
    fn clean_html() {
        assert_eq!(clean_html_text("  <td style='x'>İşlem&nbsp;Tutarı</td> :  <b>1.681,50</b> TRY\r\n"), "İşlem Tutarı : 1.681,50 TRY");
        assert_eq!(clean_html_text("a<BR>b &amp; c &lt;d&gt; &quot;e&#39; \u{a0}f"), "a b & c <d> \"e' f");
        assert_eq!(clean_html_text("<p></p>"), "");
        assert_eq!(clean_html_text("Çekilmiştir.  08/09/2026"), "Çekilmiştir. 08/09/2026");
    }
}
