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

/// Header block (before the `Tarih` column header) and the HTML that follows it.
fn split_header(html: &[u8]) -> Result<(String, String, &str), String> {
    let text = std::str::from_utf8(html).map_err(|_| "statement is not UTF-8")?;
    let head_end = text.find("Tarih").ok_or("statement header row not found")?;
    let head_text = strip_tags(&text[..head_end]);
    let account_iban = find_iban(&head_text).ok_or("account IBAN not found in header")?;
    let currency = if head_text.contains("TRY") { "TRY" } else { "?" }.to_string();
    Ok((account_iban, currency, &text[head_end..]))
}

/// Iterate `<tr>…</tr>` blocks with ≥ 5 proper `<td>…</td>` cells (the totals row uses `<td />`), unparsed.
fn row_blocks(mut rest: &str) -> impl Iterator<Item = Result<&str, String>> {
    std::iter::from_fn(move || {
        loop {
            let tr = rest.find("<tr")?;
            let after = &rest[tr..];
            let Some(end) = after.find("</tr>") else {
                rest = "";
                return Some(Err("unterminated <tr>".to_string()));
            };
            let block = &after[..end];
            rest = &after[end + 5..];
            if raw_cells(block).len() >= 5 {
                return Some(Ok(block));
            }
        }
    })
}

fn parse_row_block(tr_html: &str) -> Result<Row, String> {
    let cells = cells_of(tr_html);
    if cells.len() < 5 {
        return Err("row with fewer than 5 cells".into());
    }
    let date = parse_date(&cells[0]).ok_or_else(|| format!("bad date {:?}", cells[0]))?;
    let amount = parse_amount(&cells[3]).ok_or_else(|| format!("bad amount {:?}", cells[3]))?;
    let balance = parse_amount(&cells[4]).ok_or_else(|| format!("bad balance {:?}", cells[4]))?;
    Ok(Row {
        date_yyyymmdd: date,
        fis_no: cells[1].clone(),
        description: cells[2].clone(),
        amount_kurus: amount,
        balance_kurus: balance,
    })
}

/// Full parse (host side).
pub fn parse(html: &[u8]) -> Result<Statement, String> {
    let (account_iban, currency, rest) = split_header(html)?;
    let rows = row_blocks(rest)
        .map(|b| b.and_then(parse_row_block))
        .collect::<Result<Vec<_>, _>>()?;
    if rows.is_empty() {
        return Err("no statement rows".into());
    }
    Ok(Statement {
        account_iban,
        currency,
        rows,
    })
}

/// Parse only the header and row `index` (guest side): rows are counted exactly as `parse`
/// does, but only the requested one is decoded.
pub fn parse_row(html: &[u8], index: usize) -> Result<(String, Row), String> {
    let (account_iban, _currency, rest) = split_header(html)?;
    let block = row_blocks(rest)
        .nth(index)
        .ok_or_else(|| format!("row {index} out of range"))??;
    Ok((account_iban, parse_row_block(block)?))
}

/// Raw inner HTML of each `<td>…</td>` cell (cheap slicing, no allocation per cell).
fn raw_cells(tr_html: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut rest = tr_html;
    while let Some(td) = rest.find("<td") {
        let after = &rest[td..];
        let (Some(open_end), Some(close)) = (after.find('>'), after.find("</td>")) else { break };
        if open_end < close {
            out.push(&after[open_end + 1..close]);
        }
        rest = &after[close + 5..];
    }
    out
}

fn cells_of(tr_html: &str) -> Vec<String> {
    raw_cells(tr_html).into_iter().map(clean).collect()
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
    fn parse_row_matches_full_parse() {
        let html = b"<table><tr><td>IBAN</td><td>:</td><td>TR330006100519786457841326</td></tr><tr><td>Doviz</td><td>:</td><td>TRY</td></tr></table>\
<table><tr><th>Tarih</th><th>Fi\xc5\x9f No</th><th>A\xc3\xa7\xc4\xb1klama</th><th>Tutar</th><th>Bakiye</th></tr>\
<tr><td>05.09.2026</td><td>F1</td><td>\xc3\x96rnek Banka/TR120000000000000000000001-AHMET/FAST i\xc5\x9flemi</td><td>-1.681,50</td><td>10.836,07</td></tr>\
<tr><td>x</td><td>y</td></tr>\
<tr><td>04.09.2026</td><td>F2</td><td>POS ALI\xc5\x9eVER\xc4\xb0\xc5\x9e</td><td>-10,00</td><td>10.826,07</td></tr></table>";
        let full = parse(html).unwrap();
        assert_eq!(full.rows.len(), 2);
        for (i, row) in full.rows.iter().enumerate() {
            let (iban, r) = parse_row(html, i).unwrap();
            assert_eq!(&r, row);
            assert_eq!(iban, full.account_iban);
        }
        assert!(parse_row(html, 2).is_err());
        assert_eq!(full.rows[0].recipient_iban().as_deref(), Some("TR120000000000000000000001"));
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
