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
}

#[test]
fn outgoing_dekont_proves() {
    let Some(eml) = sample("e-dekont-outgoing") else { eprintln!("skipped: no outgoing sample"); return };
    let d = inspect_dekont(&eml).expect("dekont");
    assert_eq!(d.direction, dekont::Direction::Outgoing);
    assert!(d.fast_sorgu_no().is_some(), "Fast Sorgu No");
    assert!(d.recipient_name().is_some() && d.recipient_bank_code().is_some() && d.recipient_iban_masked().is_some());
    println!("dekont: {} {} {} amount {} debited {} bank {:?} payee {:?}", d.date_yyyymmdd, d.time, d.fis_no, d.amount_kurus, d.debited_kurus, d.recipient_bank_code(), d.recipient_name());
    let claim = prove_payment(&ProverInput { eml, dkim_pubkey_der: der(), offer_id: 9 }).expect("prove_payment");
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
    assert_eq!(prove_payment(&ProverInput { eml, dkim_pubkey_der: der(), offer_id: 1 }).unwrap_err(), Error::NotOutgoing);
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
    let c = PaymentClaim { dkim_key_hash: [1; 32], domain_hash: [2; 32], payee_hash: [3; 32], amount_kurus: 168150, date_yyyymmdd: 20260905, nullifier: [4; 32], offer_id: 7 };
    assert_eq!(PaymentClaim::from_bytes(&c.to_bytes()).unwrap(), c);
}
