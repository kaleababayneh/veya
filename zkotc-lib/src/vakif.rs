//! VakıfBank (`vakifbank.com.tr`) transfer receipts: the bank e-mails a DKIM-signed message with a
//! `Dekont.pdf` attachment. The PDF is a two-column table (label cell, value cell); `pdf::extract_cells`
//! turns it into one string per cell and this module reads the FAST fields into the same [`Dekont`]
//! shape the Ziraat parser produces, so payee binding, the reference check and the nullifier are shared.
//!
//! Real outgoing sample (2026-09-11): `İŞLEM TÜRÜ` / `FAST Giden Anlık Ödeme`, `İŞLEM TARİHİ` /
//! `11.09.2026 15:03:34`, `ALICI BANKA`, `SORGU NO`, `İŞLEM TUTARI` / `240,00 TL`, `MASRAF TUTARI`,
//! `GÖNDEREN AD SOYAD / UNVAN`, `ALICI AD SOYAD/UNVAN`, `ALICI HESAP NO / IBAN` (full IBAN), `İŞLEM NO`,
//! `FİŞ NO` (empty), `İŞLEM AÇIKLAMASI` / the payer-typed text. Incoming receipts say `Gelen FAST`.
//!
//! Trust: every cell is drawn by the bank's template; the payer-typed açıklama is one value cell and cannot
//! create cells or labels, so values are taken only as "the cell after the first exact label cell".
use crate::dekont::{Dekont, Direction};
use crate::pdf;
use crate::text::{parse_amount, parse_date_dmy};

pub const DOMAIN: &str = "vakifbank.com.tr";
/// Attachment name prefix + extension as the bank sends it.
pub const ATTACHMENT_PREFIX: &str = "Dekont";
pub const ATTACHMENT_EXT: &str = ".pdf";

/// Every label the template prints; a value cell is never one of these.
const LABELS: &[&str] = &[
    "VAKIFBANK", "İŞLEM BİLGİLERİ", "İŞLEM TÜRÜ", "İŞLEM", "İŞLEM TARİHİ", "ALICI BANKA", "BANKA", "SORGU NO", "SORGU REFERANS NO",
    "İŞLEM TUTARI", "MASRAF TUTARI", "GÖNDEREN AD SOYAD / UNVAN", "GONDEREN AD SOYAD/UNVAN", "ALICI AD SOYAD/UNVAN",
    "ALICI HESAP NO / IBAN", "ALICI HESAP NO", "İŞLEM NO", "BASLIK ISLEM NO", "FİŞ NO", "İŞLEM AÇIKLAMASI", "MÜŞTERİ AD SOYAD",
    "MÜŞTERİ NUMARASI", "TCKN/VKN",
];
const FOOTER_PREFIXES: &[&str] = &["Sicil Numarası", "Bu dekont"];

fn is_label(c: &str) -> bool {
    LABELS.contains(&c) || FOOTER_PREFIXES.iter().any(|p| c.starts_with(p))
}

/// The value cell right after the first cell equal to `label`; `None` when the label is absent or its value
/// is empty (the template then prints the next label directly).
fn value<'a>(cells: &'a [String], label: &str) -> Option<&'a str> {
    let i = cells.iter().position(|c| c == label)?;
    let v = cells.get(i + 1)?;
    (!is_label(v)).then_some(v.as_str())
}

pub fn parse(pdf_bytes: &[u8]) -> Result<Dekont, String> {
    let cells = pdf::extract_cells(pdf_bytes)?;
    if cells.first().map(String::as_str) != Some("VAKIFBANK") || cells.get(1).map(String::as_str) != Some("İŞLEM BİLGİLERİ") {
        return Err("not a VakıfBank dekont (header cells)".into());
    }
    let kind = value(&cells, "İŞLEM TÜRÜ").or_else(|| value(&cells, "İŞLEM")).ok_or("İŞLEM TÜRÜ not found")?;
    let direction = if kind.contains("Giden") {
        Direction::Outgoing
    } else if kind.contains("Gelen") {
        Direction::Incoming
    } else {
        return Err(format!("cannot determine direction from {kind:?}"));
    };
    if direction == Direction::Outgoing && !kind.starts_with("FAST") {
        return Err(format!("not a FAST transfer: {kind:?}"));
    }

    let datetime = value(&cells, "İŞLEM TARİHİ").ok_or("İŞLEM TARİHİ not found")?;
    let (date, time) = datetime.split_once(' ').ok_or_else(|| format!("bad İŞLEM TARİHİ {datetime:?}"))?;
    let date_yyyymmdd = parse_date_dmy(&date.replace('.', "/")).ok_or_else(|| format!("bad date {date:?}"))?;

    let amount_str = value(&cells, "İŞLEM TUTARI").ok_or("İŞLEM TUTARI not found")?;
    let amount_kurus = money(amount_str).ok_or_else(|| format!("bad amount {amount_str:?}"))?;
    let fee_kurus = value(&cells, "MASRAF TUTARI").and_then(money).unwrap_or(0);

    let sorgu = value(&cells, "SORGU NO").or_else(|| value(&cells, "SORGU REFERANS NO")).unwrap_or("");
    let islem_no = value(&cells, "İŞLEM NO").or_else(|| value(&cells, "BASLIK ISLEM NO")).unwrap_or("");
    let sender = value(&cells, "GÖNDEREN AD SOYAD / UNVAN").or_else(|| value(&cells, "GONDEREN AD SOYAD/UNVAN")).unwrap_or("");
    let recipient_name = value(&cells, "ALICI AD SOYAD/UNVAN").unwrap_or("");
    let recipient_iban = value(&cells, "ALICI HESAP NO / IBAN").or_else(|| value(&cells, "ALICI HESAP NO")).unwrap_or("");
    let recipient_bank = value(&cells, "ALICI BANKA").unwrap_or("");
    let aciklama = value(&cells, "İŞLEM AÇIKLAMASI").unwrap_or("");

    // `Alan Banka` must carry the bank code digits for `payee_hash_from_dekont`; the IBAN holds them at [4..9]
    let iban_norm: String = recipient_iban.chars().filter(|c| !c.is_whitespace()).collect();
    let bank_code = if iban_norm.len() == 26 { iban_norm[4..9].to_string() } else { String::new() };

    let mut fields: Vec<(String, String)> = Vec::new();
    fields.push(("Fast Sorgu No".into(), sorgu.into()));
    fields.push(("Gönderen".into(), sender.into()));
    fields.push(("Alan Banka".into(), format!("{bank_code} - {recipient_bank}")));
    fields.push(("Alıcı Hesap".into(), recipient_iban.into()));
    fields.push(("Alıcı".into(), recipient_name.into()));
    fields.push(("İşlem Tutarı".into(), amount_str.into()));
    fields.push(("İşlem No".into(), islem_no.into()));
    if !aciklama.is_empty() {
        fields.push(("Açıklama".into(), aciklama.into()));
    }

    Ok(Dekont {
        title: kind.to_string(),
        account_iban: String::new(), // the payer's own account is not printed on VakıfBank's outgoing receipt
        date_yyyymmdd,
        time: time.trim().to_string(),
        fis_no: islem_no.to_string(),
        description: aciklama.to_string(),
        settlement: format!("{kind} {datetime} {amount_str} {islem_no}"),
        direction,
        amount_kurus,
        debited_kurus: amount_kurus + fee_kurus,
        fields,
    })
}

/// `240,00 TL` → kuruş
fn money(s: &str) -> Option<u64> {
    let num = s.trim().trim_end_matches("TL").trim_end_matches("TRY").trim();
    parse_amount(num).map(|v| v.unsigned_abs())
}
