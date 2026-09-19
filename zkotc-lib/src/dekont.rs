//! Parser for Ziraat's per-transaction **e-dekont** e-mail attachment (`e-dekont.html`).
//!
//! Layout (one HTML table): a title row, key/value rows (`ŞUBE KODU/ADI`, `IBAN`, `HESAP NUMARASI`,
//! `İŞLEM TARİHİ`, `VALÖR`, `İŞLEM YERİ`), the account holder block, a description line such as
//! `_ Gönd: <name> 0209-Ziraat Katılım Bankası A.Ş. FAST işlemi 3.200,00 TRY`, and a settlement
//! sentence: `Hesabınıza 3.200,00 TL (…) Yatırılmıştır.` (incoming) or
//! `Hesabınızdan … TL (…) Çekilmiştir.` (outgoing).

use crate::text::{clean_html_text, parse_amount, parse_date_dmy};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    Incoming,
    Outgoing,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Dekont {
    /// first row, e.g. "Gelen Eft Otomatik Aktarım"
    pub title: String,
    /// account holder's IBAN (the `IBAN` key/value row), normalized
    pub account_iban: String,
    pub date_yyyymmdd: u64,
    /// `HH:MM:SS` from İŞLEM TARİHİ
    pub time: String,
    pub fis_no: String,
    /// the counterparty/transaction description line
    pub description: String,
    /// the `Hesabınıza/Hesabınızdan … TL … Yatırılmıştır/Çekilmiştir.` sentence
    pub settlement: String,
    pub direction: Direction,
    /// transfer amount in kuruş: `İşlem Tutarı` when present, else the debited amount of the settlement sentence
    pub amount_kurus: u64,
    /// amount debited from the account (settlement sentence), fees included
    pub debited_kurus: u64,
    /// `Key : Value` pairs from the description (Fast Sorgu No, Gönderen, Alan Banka, Alıcı Hesap, Alıcı, …)
    pub fields: Vec<(String, String)>,
}

/// Description keys Ziraat prints on FAST/EFT dekonts (matched as `Key :`).
const FIELD_KEYS: &[&str] = &[
    "Fast Mesaj Kodu", "Fast Sorgu No", "Gönderen", "Alan Banka", "Alıcı Hesap", "Alıcı", "İşlem Tutarı",
    "Komisyon", "BSMV", "Mesaj Ücreti", "Toplam Masraf", "Açıklama",
];

impl Dekont {
    pub fn field(&self, key: &str) -> Option<&str> {
        self.fields.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_str())
    }
    /// Unique FAST transaction reference (`Fast Sorgu No`).
    pub fn fast_sorgu_no(&self) -> Option<&str> {
        self.field("Fast Sorgu No")
    }
    /// Recipient IBAN as printed (usually masked, e.g. `TR37 **** **** **** **** 0000 01`).
    pub fn recipient_iban_masked(&self) -> Option<&str> {
        self.field("Alıcı Hesap")
    }
    /// Recipient bank code as printed (`0205` from `0205 - Kuveyt Türk …`).
    pub fn recipient_bank_code(&self) -> Option<&str> {
        self.field("Alan Banka").map(|v| v.split(" - ").next().unwrap_or(v).trim())
    }
    pub fn recipient_name(&self) -> Option<&str> {
        self.field("Alıcı")
    }
    /// Payee binding hash (see `payee`), if the dekont prints the recipient account, bank and name.
    pub fn payee_hash(&self) -> Option<[u8; 32]> {
        crate::payee::payee_hash_from_dekont(self.recipient_iban_masked()?, self.recipient_bank_code()?, self.recipient_name()?)
    }
}

/// Split `Fast Mesaj Kodu : A01 Fast Sorgu No : 720… Gönderen : …` into pairs using the known keys.
fn parse_fields(desc: &str) -> Vec<(String, String)> {
    let mut hits: Vec<(usize, usize, &str)> = Vec::new(); // (key_start, value_start, key)
    for key in FIELD_KEYS {
        let pat = format!("{key} :");
        let mut from = 0;
        while let Some(i) = desc[from..].find(&pat) {
            let start = from + i;
            // "Alıcı :" must not match inside "Alıcı Hesap :" (different pattern) — but "Alıcı :" could
            // appear right after "Alıcı Hesap : …"; that is a genuine second key, keep it.
            let at_word_start = start == 0 || desc.as_bytes()[start - 1] == b' ';
            if at_word_start {
                hits.push((start, start + pat.len(), key));
            }
            from = start + pat.len();
        }
    }
    hits.sort_by_key(|h| h.0);
    let mut out = Vec::new();
    for (i, (_, vstart, key)) in hits.iter().enumerate() {
        let vend = hits.get(i + 1).map(|h| h.0).unwrap_or(desc.len());
        let value = desc[*vstart..vend].trim();
        // the trailing free text after the last key ("1.681,50 TRY tutarında Fast işleminin …") stays attached
        // to the last key's value; strip it for amounts by keeping only the first token group when it is money
        out.push((key.to_string(), value.to_string()));
    }
    out
}

pub fn parse(html: &[u8]) -> Result<Dekont, String> {
    let text = std::str::from_utf8(html).map_err(|_| "dekont is not UTF-8")?;
    let mut kv: Vec<(String, String)> = Vec::new();
    let mut free: Vec<String> = Vec::new();
    for tr in rows(text) {
        let cells: Vec<String> = cells(tr).into_iter().map(clean_html_text).filter(|c| !c.is_empty()).collect();
        match cells.as_slice() {
            [] => {}
            [k, sep, rest @ ..] if sep == ":" => kv.push((k.to_uppercase(), rest.join(" "))),
            [k, rest @ ..] if k.ends_with(':') && !rest.is_empty() => kv.push((k.trim_end_matches(':').trim().to_uppercase(), rest.join(" "))),
            _ => free.extend(cells),
        }
    }
    let get = |key: &str| kv.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_str());

    let title = free.first().cloned().unwrap_or_default();
    // own IBAN may be printed masked ("TR89 **** **** **** **** 7050 01"); keep it normalized as-is
    let account_iban: String = get("IBAN")
        .ok_or("account IBAN row not found")?
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect();

    // "08/09/2026-15:12:48 - F04488"
    let islem = get("İŞLEM TARİHİ").or_else(|| get("ISLEM TARIHI")).ok_or("İŞLEM TARİHİ not found")?;
    let (datetime, fis_no) = islem.rsplit_once(" - ").ok_or_else(|| format!("bad İŞLEM TARİHİ {islem:?}"))?;
    let (date, time) = datetime.split_once('-').ok_or_else(|| format!("bad İŞLEM TARİHİ {islem:?}"))?;
    let date_yyyymmdd = parse_date_dmy(date).ok_or_else(|| format!("bad date {date:?}"))?;

    let settlement = free
        .iter()
        .find(|c| c.contains("Hesabınız"))
        .cloned()
        .ok_or("settlement sentence (Hesabınıza/Hesabınızdan …) not found")?;
    let direction = if settlement.contains("Hesabınızdan") && settlement.contains("Çekilmiştir") {
        Direction::Outgoing
    } else if settlement.contains("Hesabınıza") && settlement.contains("Yatırılmıştır") {
        Direction::Incoming
    } else {
        return Err(format!("cannot determine direction from {settlement:?}"));
    };
    let debited_kurus = amount_before_tl(&settlement).ok_or_else(|| format!("amount not found in {settlement:?}"))?;

    let description = free
        .iter()
        .find(|c| *c != &settlement && (c.contains("işlemi") || c.contains(" TRY") || c.contains("Gönd") || c.contains("Alıcı")))
        .cloned()
        .unwrap_or_default();
    let fields = parse_fields(&description);
    let amount_kurus = fields
        .iter()
        .find(|(k, _)| k == "İşlem Tutarı")
        .and_then(|(_, v)| v.split_whitespace().next())
        .and_then(parse_amount)
        .map(|v| v.unsigned_abs())
        .unwrap_or(debited_kurus);

    Ok(Dekont {
        title,
        account_iban,
        date_yyyymmdd,
        time: time.trim().to_string(),
        fis_no: fis_no.trim().to_string(),
        description,
        settlement,
        direction,
        amount_kurus,
        debited_kurus,
        fields,
    })
}

/// The number immediately before " TL" in `Hesabınıza 3.200,00 TL (…)`.
fn amount_before_tl(s: &str) -> Option<u64> {
    let idx = s.find(" TL")?;
    let head = &s[..idx];
    let start = head.rfind(' ').map(|i| i + 1).unwrap_or(0);
    parse_amount(&head[start..]).map(|v| v.unsigned_abs())
}

fn rows(html: &str) -> impl Iterator<Item = &str> {
    let mut rest = html;
    std::iter::from_fn(move || {
        let tr = rest.find("<tr")?;
        let after = &rest[tr..];
        let end = after.find("</tr>")?;
        rest = &after[end + 5..];
        Some(&after[..end])
    })
}

fn cells(tr_html: &str) -> Vec<&str> {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn html(desc: &str, settlement: &str) -> Vec<u8> {
        format!(
            "<table><tr><td>Giden Eft</td></tr>\
<tr><td>ŞUBE KODU/ADI</td><td>:</td><td>0935/ÇAĞLAYAN/İSTANBUL ŞUBESİ</td></tr>\
<tr><td>IBAN</td><td>:</td><td>TR33 0006 1005 1978 6457 8413 26</td></tr>\
<tr><td>İŞLEM TARİHİ</td><td>:</td><td>05/09/2026-18:21:03 - F05247</td></tr>\
<tr><td>VALÖR</td><td>:</td><td>05.09.2026</td></tr>\
<tr><td>SAYIN</td></tr><tr><td>AYŞE YILMAZ</td></tr>\
<tr><td>{desc}</td><td></td></tr>\
<tr><td>{settlement}</td><td>Saygılarımızla T.C. ZİRAAT BANKASI A.Ş.</td></tr></table>"
        )
        .into_bytes()
    }

    #[test]
    fn outgoing_fast_masked_layout() {
        let d = parse(&html(
            "Fast Mesaj Kodu : A01 Fast Sorgu No : 7206667617<BR>Gönderen : AYŞE YILMAZ<BR>Alan Banka : 0205 - Örnek Katılım Bankası A.Ş.<BR>Alıcı Hesap : TR12 **** **** **** **** 0000 01 Alıcı : AHMET DEMİR<BR>İşlem Tutarı : 1.681,50 TRY<BR>Komisyon : 7,62 TRY BSMV : 0,38 TRY Mesaj Ücreti : 0,37 TRY Toplam Masraf : 8,37 TRY 1.681,50 TRY tutarında Fast işleminin yapılmasını talep ederim.",
            "Hesabınızdan 1.689,87 TL (Yalnız BİNALTIYÜZSEKSENDOKUZTLSEKSENYEDİKR) Çekilmiştir. 08/09/2026-21:46:10 EFTTGIDD INTERNET INTERNET",
        ))
        .unwrap();
        assert_eq!(d.direction, Direction::Outgoing);
        assert_eq!(d.amount_kurus, 168150, "İşlem Tutarı, not the debited total");
        assert_eq!(d.debited_kurus, 168987);
        assert_eq!(d.date_yyyymmdd, 20260905);
        assert_eq!(d.time, "18:21:03");
        assert_eq!(d.fis_no, "F05247");
        assert_eq!(d.fast_sorgu_no(), Some("7206667617"));
        assert_eq!(d.recipient_bank_code(), Some("0205"));
        assert_eq!(d.recipient_iban_masked(), Some("TR12 **** **** **** **** 0000 01"));
        assert_eq!(d.recipient_name(), Some("AHMET DEMİR"));
        assert_eq!(d.payee_hash(), crate::payee::payee_hash_from_full("TR12 0020 5000 0000 0000 0000 01", "Ahmet Demir"));
    }

    #[test]
    fn incoming_is_detected() {
        let d = parse(&html(
            "_ Gönd: Ali Veli 0209-Ziraat Katılım Bankası A.Ş. FAST işlemi 3.200,00 TRY",
            "Hesabınıza 3.200,00 TL (Yalnız ÜÇBİNİKİYÜZTL) Yatırılmıştır. 08/09/2026-17:45:07 EFTTGELD SERVICE _",
        ))
        .unwrap();
        assert_eq!(d.direction, Direction::Incoming);
        assert_eq!(d.amount_kurus, 320000);
        assert_eq!(d.payee_hash(), None);
    }
}
