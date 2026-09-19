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

#[test]
fn incoming_dekont_is_rejected() {
    let Some(eml) = sample("e-dekont-incoming") else { return };
    let d = inspect_dekont(&eml).expect("dekont");
    assert_eq!(d.direction, dekont::Direction::Incoming);
    assert_eq!(prove_payment(&ProverInput { eml, dkim_pubkey_der: der(), offer_id: 1, attachment: None, reference: "ZKOTC 1 000000".into() }).unwrap_err(), Error::NotOutgoing);
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
    assert!(r.starts_with("ZKOTC 3 ") && r.len() == "ZKOTC 3 ".len() + 6, "{r}");
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
