//! Small text utilities shared by the parsers (Turkish number/date formats, IBAN search, HTML text).

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

pub fn strip_tags(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for c in s.chars() {
        match c {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                out.push(' ');
            }
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out
}

/// Tags removed, common entities decoded, whitespace collapsed.
pub fn clean_html_text(s: &str) -> String {
    let s = strip_tags(s)
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ");
    s.split_whitespace().collect::<Vec<_>>().join(" ")
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
}
