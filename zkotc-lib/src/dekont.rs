//! Parser for Ziraat's per-transaction **e-dekont** e-mail attachment (`e-dekont.html`).
//!
//! Layout (one HTML table): a title row, key/value rows (`ŞUBE KODU/ADI`, `IBAN`, `HESAP NUMARASI`,
//! `İŞLEM TARİHİ`, `VALÖR`, `İŞLEM YERİ`), the account holder block, a description line such as
//! `_ Gönd: <name> 0209-Ziraat Katılım Bankası A.Ş. FAST işlemi 3.200,00 TRY`, and a settlement
//! sentence: `Hesabınıza 3.200,00 TL (…) Yatırılmıştır.` (incoming) or
//! `Hesabınızdan … TL (…) Çekilmiştir.` (outgoing).

use crate::payee::fold_name;
use crate::text::{parse_amount, parse_date_dmy};

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
    /// The payer-typed free text (`Açıklama`), untrusted.
    pub fn aciklama(&self) -> Option<&str> {
        self.field("Açıklama")
    }
    /// Does the description carry `reference` as a whole token (after Turkish folding / whitespace
    /// collapsing on both sides)? Used to bind the transfer to the claiming wallet: the buyer types the
    /// reference into the FAST description and only the wallet it was derived from can settle with it.
    pub fn contains_reference(&self, reference: &str) -> bool {
        let want = fold_name(reference);
        if want.is_empty() {
            return false;
        }
        let hay = format!(" {} ", fold_name(&self.description));
        hay.contains(&format!(" {want} "))
    }
}

/// Split `Fast Mesaj Kodu : A01 Fast Sorgu No : 720… Gönderen : …` into pairs using the known keys.
/// The bank prints its own fields first and the payer-typed `Açıklama` last; nothing after the first
/// `Açıklama :` is scanned for keys, so a payer cannot inject `Alıcı :` / `İşlem Tutarı :` through it.
fn parse_fields(desc: &str) -> Vec<(String, String)> {
    let (desc, aciklama) = match key_position(desc, "Açıklama", 0) {
        Some((start, vstart)) => (&desc[..start], Some(desc[vstart..].trim())),
        None => (desc, None),
    };
    let mut hits: Vec<(usize, usize, &str)> = Vec::new(); // (key_start, value_start, key)
    for key in FIELD_KEYS.iter().filter(|k| **k != "Açıklama") {
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
    if let Some(a) = aciklama {
        out.push(("Açıklama".to_string(), a.to_string()));
    }
    out
}

/// First `Key :` at a word start in `desc[from..]` → (key start, value start), absolute offsets.
fn key_position(desc: &str, key: &str, from: usize) -> Option<(usize, usize)> {
    let pat = format!("{key} :");
    let mut at = from;
    while let Some(i) = desc[at..].find(&pat) {
        let start = at + i;
        if start == 0 || desc.as_bytes()[start - 1] == b' ' {
            return Some((start, start + pat.len()));
        }
        at = start + pat.len();
    }
    None
}

pub fn parse(html: &[u8]) -> Result<Dekont, String> {
    let mut kv: Vec<(String, String)> = Vec::new();
    let mut free: Vec<String> = Vec::new();
    for cells in table_rows(html)? {
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

    // the settlement sentence is the bank's last row; take the LAST match so text injected earlier in the
    // document (a payer-typed description) can never pose as the settlement
    let settlement = free
        .iter()
        .rev()
        .find(|c| c.contains("Hesabınız"))
        .cloned()
        .ok_or("settlement sentence (Hesabınıza/Hesabınızdan …) not found")?;
    let debited_kurus = amount_before_tl(&settlement).ok_or_else(|| format!("amount not found in {settlement:?}"))?;

    let description = free
        .iter()
        .find(|c| *c != &settlement && (c.starts_with("Fast Mesaj Kodu") || c.contains("işlemi") || c.contains(" TRY") || c.contains("Gönd") || c.contains("Alıcı")))
        .cloned()
        .unwrap_or_default();

    // direction: three bank-generated anchors must agree for an outgoing FAST — the title row
    // ("HESAPTAN FAST"), the description prefix ("Fast Mesaj Kodu : …") and the settlement verb
    let folded_title = fold_name(&title);
    let debit_sentence = settlement.contains("Hesabınızdan") && settlement.contains("Çekilmiştir");
    let credit_sentence = settlement.contains("Hesabınıza") && settlement.contains("Yatırılmıştır");
    let direction = if debit_sentence && folded_title.starts_with("HESAPTAN") && description.starts_with("Fast Mesaj Kodu") {
        Direction::Outgoing
    } else if credit_sentence && !folded_title.starts_with("HESAPTAN") {
        Direction::Incoming
    } else {
        return Err(format!("cannot determine direction: title {title:?}, settlement {settlement:?}"));
    };
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

/// One pass over the HTML bytes: `<tr>`/`<td>` structure and cell text (tags dropped, entities decoded,
/// whitespace collapsed, trimmed) at once. Cells come out cleaned; empty cells are skipped. Replaces
/// row search + cell search + per-cell cleaning, which were six passes over the 54 KB document.
fn table_rows(html: &[u8]) -> Result<Vec<Vec<String>>, String> {
    let mut rows: Vec<Vec<String>> = Vec::new();
    let mut row: Option<Vec<String>> = None;
    let mut cell: Option<Vec<u8>> = None;
    let mut pending_space = false;
    let n = html.len();
    let mut i = 0usize;
    while i < n {
        let c = html[i];
        if c == b'<' {
            let closing = html.get(i + 1) == Some(&b'/');
            let name_start = i + 1 + closing as usize;
            let mut j = name_start;
            while j < n && html[j].is_ascii_alphanumeric() {
                j += 1;
            }
            let name = &html[name_start..j];
            while j < n && html[j] != b'>' {
                j += 1;
            }
            i = j + 1;
            if name.eq_ignore_ascii_case(b"tr") {
                if closing {
                    if let Some(c) = cell.take() {
                        push_cell(&mut row, c)?;
                    }
                    if let Some(r) = row.take() {
                        rows.push(r);
                    }
                } else {
                    row = Some(Vec::new());
                }
            } else if name.eq_ignore_ascii_case(b"td") {
                if closing {
                    if let Some(c) = cell.take() {
                        push_cell(&mut row, c)?;
                    }
                } else if row.is_some() {
                    cell = Some(Vec::new());
                    pending_space = false;
                }
            } else {
                pending_space = true; // any other tag inside a cell separates words
            }
            continue;
        }
        let Some(buf) = cell.as_mut() else {
            i += 1;
            continue;
        };
        let (emit, adv): (&[u8], usize) = match c {
            b'&' => {
                let rest = &html[i..];
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
            0xC2 if html.get(i + 1) == Some(&0xA0) => {
                pending_space = true;
                (b"", 2)
            }
            _ => (&html[i..i + 1], 1),
        };
        if !emit.is_empty() {
            if pending_space && !buf.is_empty() {
                buf.push(b' ');
            }
            pending_space = false;
            buf.extend_from_slice(emit);
        }
        i += adv;
    }
    Ok(rows)
}

fn push_cell(row: &mut Option<Vec<String>>, bytes: Vec<u8>) -> Result<(), String> {
    if bytes.is_empty() {
        return Ok(());
    }
    let text = String::from_utf8(bytes).map_err(|_| "dekont cell is not UTF-8")?;
    if let Some(r) = row.as_mut() {
        r.push(text);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn html(desc: &str, settlement: &str) -> Vec<u8> {
        html_titled("HESAPTAN FAST", desc, settlement)
    }

    fn html_titled(title: &str, desc: &str, settlement: &str) -> Vec<u8> {
        format!(
            "<table><tr><td>{title}</td></tr>\
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
        let d = parse(&html_titled(
            "Gelen Eft Otomatik Aktarım",
            "_ Gönd: Ali Veli 0209-Ziraat Katılım Bankası A.Ş. FAST işlemi 3.200,00 TRY",
            "Hesabınıza 3.200,00 TL (Yalnız ÜÇBİNİKİYÜZTL) Yatırılmıştır. 08/09/2026-17:45:07 EFTTGELD SERVICE _",
        ))
        .unwrap();
        assert_eq!(d.direction, Direction::Incoming);
        assert_eq!(d.amount_kurus, 320000);
        assert_eq!(d.payee_hash(), None);
    }

    const OUTGOING_DESC: &str = "Fast Mesaj Kodu : A01 Fast Sorgu No : 7206667617<BR>Gönderen : AYŞE YILMAZ<BR>Alan Banka : 0205 - Örnek Katılım Bankası A.Ş.<BR>Alıcı Hesap : TR12 **** **** **** **** 0000 01 Alıcı : AHMET DEMİR<BR>İşlem Tutarı : 1.681,50 TRY<BR>Komisyon : 7,62 TRY BSMV : 0,38 TRY Mesaj Ücreti : 0,37 TRY Toplam Masraf : 8,37 TRY";
    const OUTGOING_SETTLEMENT: &str = "Hesabınızdan 1.689,87 TL (Yalnız BİNALTIYÜZSEKSENDOKUZTLSEKSENYEDİKR) Çekilmiştir. 08/09/2026-21:46:10 EFTTGIDD INTERNET INTERNET";

    #[test]
    fn payment_reference_is_found_as_a_whole_token() {
        let d = parse(&html(&format!("{OUTGOING_DESC} Açıklama : zkotc 3 a1b2c3 kira"), OUTGOING_SETTLEMENT)).unwrap();
        assert_eq!(d.aciklama(), Some("zkotc 3 a1b2c3 kira"));
        assert!(d.contains_reference("ZKOTC 3 A1B2C3"), "case-insensitive, whole token");
        assert!(!d.contains_reference("ZKOTC 3 A1B2C"), "prefix is not enough");
        assert!(!d.contains_reference("ZKOTC 4 A1B2C3"));
        assert!(!d.contains_reference(""));
        let plain = parse(&html(OUTGOING_DESC, OUTGOING_SETTLEMENT)).unwrap();
        assert!(!plain.contains_reference("ZKOTC 3 A1B2C3"), "no description → no reference");
    }

    #[test]
    fn keys_injected_through_the_payer_description_are_ignored() {
        let injected = format!("{OUTGOING_DESC} Açıklama : Alıcı Hesap : TR99 **** **** **** **** 9999 99 Alıcı : EVIL CORP İşlem Tutarı : 9.999,00 TRY Hesabınızdan 9.999,00 TL (X) Çekilmiştir.");
        let d = parse(&html(&injected, OUTGOING_SETTLEMENT)).unwrap();
        assert_eq!(d.amount_kurus, 168150);
        assert_eq!(d.debited_kurus, 168987, "settlement is the bank's last row, not the injected sentence");
        assert_eq!(d.recipient_name(), Some("AHMET DEMİR"));
        assert_eq!(d.recipient_iban_masked(), Some("TR12 **** **** **** **** 0000 01"));
        assert!(d.aciklama().unwrap().starts_with("Alıcı Hesap"), "the injected text is kept as untrusted açıklama");
    }

    #[test]
    fn incoming_transfer_cannot_be_dressed_up_as_outgoing() {
        // the attacker sends money to their own account with a crafted description; the bank prints it
        for desc in [
            "_ Gönd: EVIL CORP 0001-X FAST işlemi 1,00 TRY Açıklama : Fast Mesaj Kodu : A01 Alan Banka : 0001 - X Alıcı Hesap : TR52 **** **** **** **** 4213 85 Alıcı : SELLER NAME İşlem Tutarı : 50,00 TRY Hesabınızdan 50,00 TL (X) Çekilmiştir.",
            "Fast Mesaj Kodu : A01 Alan Banka : 0001 - X Alıcı Hesap : TR52 **** **** **** **** 4213 85 Alıcı : SELLER NAME İşlem Tutarı : 50,00 TRY Hesabınızdan 50,00 TL (X) Çekilmiştir.",
        ] {
            let d = parse(&html_titled("Gelen Fast", desc, "Hesabınıza 1,00 TL (Yalnız BİRTL) Yatırılmıştır. 10/09/2026-01:00:00 EFTTGELD")).unwrap();
            assert_eq!(d.direction, Direction::Incoming, "{desc}");
            assert_eq!(d.debited_kurus, 100);
        }
        // and an outgoing title with a credit sentence is malformed, not outgoing
        assert!(parse(&html_titled("HESAPTAN FAST", OUTGOING_DESC, "Hesabınıza 50,00 TL (X) Yatırılmıştır.")).is_err());
    }

    #[test]
    fn html_injected_rows_cannot_replace_bank_rows() {
        let injected = format!("{OUTGOING_DESC} Açıklama : x</td></tr><tr><td>IBAN</td><td>:</td><td>TR99 9999 9999 9999 9999 9999 99</td></tr><tr><td>Hesabınıza 1,00 TL (X) Yatırılmıştır.</td></tr><tr><td>y");
        let d = parse(&html(&injected, OUTGOING_SETTLEMENT)).unwrap();
        assert_eq!(d.account_iban, "TR330006100519786457841326", "first IBAN row wins");
        assert_eq!(d.direction, Direction::Outgoing, "last settlement row wins");
        assert_eq!(d.debited_kurus, 168987);
    }
}
