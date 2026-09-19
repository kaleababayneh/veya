//! Parser for the Ziraat "Hesap Hareketleri" HTML statement.
//!
//! Layout: header table (Sayın / Şube Kodu / Müşteri-Hesap No / Adres / IBAN / Döviz Cinsi / Dönem)
//! then a table with header row `Tarih | Fiş No | Açıklama | Tutar | Bakiye` and one `<tr>` per row.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Row {
    pub date_yyyymmdd: u64,
    pub fis_no: String,
    pub description: String,
    /// signed kuruş; negative = outgoing
    pub amount_kurus: i64,
    pub balance_kurus: i64,
}

impl Row {
    /// First Turkish IBAN (`TR` + 24 digits) in the description, if any.
    pub fn recipient_iban(&self) -> Option<String> {
        find_iban(&self.description)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Statement {
    /// account holder's IBAN from the header block
    pub account_iban: String,
    pub currency: String,
    pub rows: Vec<Row>,
}

pub fn parse(html: &[u8]) -> Result<Statement, String> {
    let text = String::from_utf8_lossy(html);
    let head_end = text.find("Tarih").ok_or("statement header row not found")?;
    let head_text = strip_tags(&text[..head_end]);
    let account_iban = find_iban(&head_text).ok_or("account IBAN not found in header")?;
    let currency = if head_text.contains("TRY") { "TRY" } else { "?" }.to_string();

    let mut rows = Vec::new();
    let mut rest = &text[head_end..];
    while let Some(tr) = rest.find("<tr") {
        let after = &rest[tr..];
        let end = after.find("</tr>").ok_or("unterminated <tr>")?;
        let tr_html = &after[..end];
        rest = &after[end + 5..];
        let cells = cells_of(tr_html);
        if cells.len() < 5 || cells[0] == "Tarih" {
            continue;
        }
        let date = parse_date(&cells[0]).ok_or_else(|| format!("bad date {:?}", cells[0]))?;
        let amount = parse_amount(&cells[3]).ok_or_else(|| format!("bad amount {:?}", cells[3]))?;
        let balance = parse_amount(&cells[4]).ok_or_else(|| format!("bad balance {:?}", cells[4]))?;
        rows.push(Row {
            date_yyyymmdd: date,
            fis_no: cells[1].clone(),
            description: cells[2].clone(),
            amount_kurus: amount,
            balance_kurus: balance,
        });
    }
    if rows.is_empty() {
        return Err("no statement rows".into());
    }
    Ok(Statement {
        account_iban,
        currency,
        rows,
    })
}

fn cells_of(tr_html: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = tr_html;
    while let Some(td) = rest.find("<td") {
        let after = &rest[td..];
        let open_end = match after.find('>') {
            Some(i) => i + 1,
            None => break,
        };
        let close = match after.find("</td>") {
            Some(i) => i,
            None => break,
        };
        out.push(clean(&after[open_end..close]));
        rest = &after[close + 5..];
    }
    out
}

fn strip_tags(s: &str) -> String {
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

fn clean(s: &str) -> String {
    let s = strip_tags(s)
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ");
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// `dd.mm.yyyy` -> yyyymmdd
fn parse_date(s: &str) -> Option<u64> {
    let mut it = s.trim().split('.');
    let d: u64 = it.next()?.parse().ok()?;
    let m: u64 = it.next()?.parse().ok()?;
    let y: u64 = it.next()?.parse().ok()?;
    if !(1..=31).contains(&d) || !(1..=12).contains(&m) || !(2000..=2200).contains(&y) {
        return None;
    }
    Some(y * 10_000 + m * 100 + d)
}

/// `-1.681,50` -> -168150 kuruş
fn parse_amount(s: &str) -> Option<i64> {
    let s = s.trim();
    let neg = s.starts_with('-');
    let s = s.trim_start_matches(['-', '+']);
    let (int, frac) = s.split_once(',').unwrap_or((s, "00"));
    let int: i64 = int.replace('.', "").parse().ok()?;
    let frac: i64 = format!("{:0<2}", frac).get(..2)?.parse().ok()?;
    let v = int * 100 + frac;
    Some(if neg { -v } else { v })
}

/// First occurrence of `TR` followed by 24 digits (spaces inside the IBAN are tolerated).
pub fn find_iban(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut i = 0;
    while i + 2 <= b.len() {
        if &b[i..i + 2] == b"TR" {
            let mut digits = String::with_capacity(24);
            let mut j = i + 2;
            while j < b.len() && digits.len() < 24 {
                if b[j].is_ascii_digit() {
                    digits.push(b[j] as char);
                } else if b[j] == b' ' {
                } else {
                    break;
                }
                j += 1;
            }
            if digits.len() == 24 {
                return Some(format!("TR{digits}"));
            }
        }
        i += 1;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn amounts_and_dates() {
        assert_eq!(parse_amount("-1.681,50"), Some(-168150));
        assert_eq!(parse_amount("9.617,61"), Some(961761));
        assert_eq!(parse_amount("-0,02"), Some(-2));
        assert_eq!(parse_amount("169,00"), Some(16900));
        assert_eq!(parse_date("05.09.2026"), Some(20260905));
        assert_eq!(parse_date("32.09.2026"), None);
    }

    #[test]
    fn iban_search() {
        assert_eq!(
            find_iban("Kuveyt Türk Katılım Bankası A.Ş./TR120000000000000000000001-AHMET/FAST işlemi"),
            Some("TR120000000000000000000001".into())
        );
        assert_eq!(find_iban("IBAN : TR33 0006 1005 1978 6457 8413 26"), Some("TR330006100519786457841326".into()));
        assert_eq!(find_iban("TRY 12"), None);
    }
}
