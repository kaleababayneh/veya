//! Tests against REAL Ziraat e-dekont e-mails (git-ignored, see testdata/README.md):
//! `e-dekont-outgoing*.eml` (a FAST the account holder sent) must prove; `e-dekont-incoming*.eml` must be
//! rejected as NotOutgoing. Both must DKIM-verify.
use zkotc_lib::*;

fn dir() -> String {
    format!("{}/testdata", env!("CARGO_MANIFEST_DIR"))
}
fn der() -> Vec<u8> {
    std::fs::read(format!("{}/ziraat-ileti-msg2.der", dir())).unwrap()
}
fn vakif_der() -> Vec<u8> {
    std::fs::read(format!("{}/vakifbank-smtp2.der", dir())).unwrap()
}
fn sample(prefix: &str) -> Option<Vec<u8>> {
    std::fs::read_dir(format!("{}/private", dir()))
        .ok()?
        .filter_map(|e| e.ok())
        .find(|e| e.file_name().to_string_lossy().starts_with(prefix))
        .and_then(|e| std::fs::read(e.path()).ok())
        .map(|eml| dkim::normalized(&eml).into_owned()) // the host does this before proving
}

#[test]
fn outgoing_dekont_proves() {
    let Some(eml) = sample("e-dekont-outgoing") else { eprintln!("skipped: no outgoing sample"); return };
    let d = inspect_dekont(&eml).expect("dekont");
    assert_eq!(d.direction, dekont::Direction::Outgoing);
    assert!(d.fast_sorgu_no().is_some(), "Fast Sorgu No");
    assert!(d.recipient_name().is_some() && d.recipient_bank_code().is_some() && d.recipient_iban_masked().is_some());
    println!("dekont: {} {} {} amount {} debited {} bank {:?} payee {:?}", d.date_yyyymmdd, d.time, d.fis_no, d.amount_kurus, d.debited_kurus, d.recipient_bank_code(), d.recipient_name());
    // this sample was sent without a payment reference: the guest must refuse it for the expected one
    let expected = payment_reference(9, "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF");
    assert_eq!(
        prove_payment(&ProverInput { eml: eml.clone(), dkim_pubkey_der: der(), offer_id: 9, attachment: None, reference: expected.clone() }).unwrap_err(),
        Error::ReferenceMissing { expected: expected.clone() }
    );
    // …and accepts a reference that does occur in the description (the FAST message code), proving the
    // rest of the pipeline end to end on real signed mail
    let d0 = inspect_dekont(&eml).unwrap();
    let token = d0.field("Fast Sorgu No").unwrap().to_string();
    let claim = prove_payment(&ProverInput { eml, dkim_pubkey_der: der(), offer_id: 9, attachment: None, reference: token.clone() }).expect("prove_payment");
    assert_eq!(claim.reference_hash, reference_hash(&token));
    assert_eq!(claim.amount_kurus, d.amount_kurus);
    assert_eq!(claim.date_yyyymmdd, d.date_yyyymmdd);
    assert_eq!(claim.payee_hash, d.payee_hash().unwrap());
    assert_eq!(claim.offer_id, 9);
    println!("public values: {}", hex::encode(claim.to_bytes()));
}

/// A real dekont of a FAST sent WITH the wallet reference typed into the açıklama (reservation #7 on
/// testnet, 2026-09-12): Ziraat prints the typed text in front of its own fields.
#[test]
fn outgoing_dekont_with_reference_proves() {
    let Some(eml) = sample("e-dekont-reference") else { eprintln!("skipped: no reference sample"); return };
    let d = inspect_dekont(&eml).expect("dekont");
    assert_eq!(d.direction, dekont::Direction::Outgoing);
    assert_eq!(d.amount_kurus, 5000, "İşlem Tutarı, not the debited total with fees");
    assert_eq!(d.debited_kurus, 5837);
    assert_eq!(d.recipient_name(), Some("KALEAB ABAYNEH GIZAW"));
    // typed with the spaced format of the time; the format is now one token
    assert_eq!(d.aciklama(), Some("ZKOTC 7 089340"));
    assert_eq!(payment_reference(7, "GD7LIYDVF6MUAE2OZUJB4DXJU3SIKNUVDDSMMCCXSCMXA6ZIDB7M5WXZ"), "ZKOTC7089340");
    let expected = "ZKOTC 7 089340".to_string();
    let claim = prove_payment(&ProverInput { eml, dkim_pubkey_der: der(), offer_id: 7, attachment: None, reference: expected.clone() }).expect("prove_payment");
    assert_eq!(claim.reference_hash, reference_hash(&expected));
    assert_eq!(claim.amount_kurus, 5000);
    assert_eq!(claim.date_yyyymmdd, 20260912);
    assert_eq!(claim.payee_hash, d.payee_hash().unwrap());
}

#[test]
fn incoming_dekont_is_rejected() {
    let Some(eml) = sample("e-dekont-incoming") else { return };
    let d = inspect_dekont(&eml).expect("dekont");
    assert_eq!(d.direction, dekont::Direction::Incoming);
    assert_eq!(prove_payment(&ProverInput { eml, dkim_pubkey_der: der(), offer_id: 1, attachment: None, reference: "ZKOTC1000000".into() }).unwrap_err(), Error::NotOutgoing);
}

#[test]
fn dkim_verifies_and_detects_tampering() {
    let Some(eml) = sample("e-dekont") else { return };
    let der = der();
    let v = dkim::verify(&eml, &der).expect("DKIM must verify");
    assert_eq!(v.domain, "ileti.ziraatbank.com.tr");
    assert_eq!(v.selector, "msg2");
    let mut bad = eml.clone();
    let l = bad.len();
    bad[l - 200] ^= 0x01;
    assert_eq!(dkim::verify(&bad, &der).unwrap_err(), dkim::DkimError::BodyHashMismatch);
}

#[test]
fn claim_roundtrip() {
    let c = PaymentClaim { dkim_key_hash: [1; 32], domain_hash: [2; 32], payee_hash: [3; 32], amount_kurus: 168150, date_yyyymmdd: 20260905, nullifier: [4; 32], offer_id: 7, reference_hash: [5; 32] };
    assert_eq!(c.to_bytes().len(), PUBLIC_VALUES_LEN);
    assert_eq!(PaymentClaim::from_bytes(&c.to_bytes()).unwrap(), c);
}

#[test]
fn payment_reference_format() {
    let r = payment_reference(3, "GCKKGUXAMPLEADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXMK65H");
    assert!(r.starts_with("ZKOTC3") && r.len() == "ZKOTC3".len() + 6 && !r.contains(' '), "{r}");
    assert!(r[8..].chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_lowercase()));
    assert_eq!(payment_reference(3, " GCKKGUXAMPLEADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXMK65H "), r, "whitespace-insensitive");
    assert_eq!(reference_hash(&r), reference_hash(&r.to_lowercase()), "folded before hashing");
    assert_ne!(payment_reference(4, "GCKKGUXAMPLEADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXMK65H"), r);
}

#[test]
fn dkim_rejects_length_limited_signatures() {
    let eml = b"DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/simple; d=ileti.ziraatbank.com.tr; s=msg2; l=10;\r\n\th=from:subject; bh=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=; b=AAAA\r\nFrom: a@ileti.ziraatbank.com.tr\r\nSubject: x\r\n\r\nbody\r\n";
    assert_eq!(dkim::verify(eml, &der()).unwrap_err(), dkim::DkimError::BodyLengthTag);
}

// ───────────────────────────── VakıfBank (PDF dekont) ─────────────────────────────

/// Real outgoing FAST from a VakıfBank account (2026-09-11, ₺240 with fees ₺8.37): DKIM verifies with the
/// bank's smtp2 key, the PDF parses into the shared Dekont shape, and the typed açıklama carries the reference.
#[test]
fn vakif_outgoing_dekont_proves() {
    let Some(eml) = sample("vakif-outgoing") else { eprintln!("skipped: no vakif outgoing sample"); return };
    assert_eq!(provider_of(&eml), Some(Provider::Vakif));
    let d = inspect_dekont(&eml).expect("dekont");
    assert_eq!(d.direction, dekont::Direction::Outgoing);
    assert_eq!(d.date_yyyymmdd, 20260911);
    assert_eq!(d.time, "15:03:34");
    assert_eq!(d.amount_kurus, 24000);
    assert_eq!(d.debited_kurus, 24837);
    assert_eq!(d.fast_sorgu_no(), Some("2920248293"));
    assert_eq!(d.recipient_iban_masked(), Some("TR40 0001 2009 7610 0004 0001 30"));
    assert_eq!(d.recipient_bank_code(), Some("00012"));
    assert_eq!(d.recipient_name(), Some("İ.T.Ü.STRATEJİ GELİŞTİRME DAİRE BAŞKANLIĞI"));
    assert_eq!(d.aciklama(), Some("YUZME HAVUZU AYLİK 707261015"));
    // payee binding is the same derivation the escrow uses for a full IBAN + name
    assert_eq!(d.payee_hash(), payee::payee_hash_from_full("TR40 0001 2009 7610 0004 0001 30", "İ.T.Ü.STRATEJİ GELİŞTİRME DAİRE BAŞKANLIĞI"));
    // wrong-wallet reference is refused; a token that is in the açıklama proves end to end
    let expected = payment_reference(9, "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF");
    assert_eq!(
        prove_payment(&ProverInput { eml: eml.clone(), dkim_pubkey_der: vakif_der(), offer_id: 9, attachment: None, reference: expected.clone() }).unwrap_err(),
        Error::ReferenceMissing { expected }
    );
    let claim = prove_payment(&ProverInput { eml, dkim_pubkey_der: vakif_der(), offer_id: 9, attachment: None, reference: "707261015".into() }).expect("prove_payment");
    assert_eq!(claim.amount_kurus, 24000);
    assert_eq!(claim.date_yyyymmdd, 20260911);
    assert_eq!(claim.payee_hash, d.payee_hash().unwrap());
    assert_eq!(claim.domain_hash, sha256_of(b"vakifbank.com.tr"));
    assert_eq!(claim.dkim_key_hash, sha256_of(&vakif_der()));
}

/// The receiving side of a transfer (`Gelen FAST`) must never prove a payment.
#[test]
fn vakif_incoming_dekont_is_rejected() {
    let Some(eml) = sample("vakif-incoming") else { eprintln!("skipped: no vakif incoming sample"); return };
    let d = inspect_dekont(&eml).expect("dekont");
    assert_eq!(d.direction, dekont::Direction::Incoming);
    assert_eq!(d.amount_kurus, 5800);
    assert_eq!(d.aciklama(), Some("ZKOTC8089340"));
    assert_eq!(prove_payment(&ProverInput { eml, dkim_pubkey_der: vakif_der(), offer_id: 8, attachment: None, reference: "ZKOTC8089340".into() }).unwrap_err(), Error::NotOutgoing);
}

/// A Ziraat key cannot verify a Vakıf mail and vice versa.
#[test]
fn keys_are_not_interchangeable() {
    let Some(eml) = sample("vakif-outgoing") else { return };
    assert!(matches!(prove_payment(&ProverInput { eml, dkim_pubkey_der: der(), offer_id: 1, attachment: None, reference: "707261015".into() }).unwrap_err(), Error::Dkim(_)));
}

fn sha256_of(b: &[u8]) -> [u8; 32] {
    use sha2::Digest;
    sha2::Sha256::digest(b).into()
}
