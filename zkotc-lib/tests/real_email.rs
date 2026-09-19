//! End-to-end test against a REAL Ziraat statement e-mail (git-ignored, see testdata/README.md).
use zkotc_lib::*;

fn load() -> Option<(Vec<u8>, Vec<u8>)> {
    let dir = format!("{}/testdata", env!("CARGO_MANIFEST_DIR"));
    let der = std::fs::read(format!("{dir}/ziraat-ileti-msg2.der")).ok()?;
    let eml = std::fs::read_dir(format!("{dir}/private"))
        .ok()?
        .filter_map(|e| e.ok())
        .find(|e| e.file_name().to_string_lossy().ends_with(".eml"))
        .and_then(|e| std::fs::read(e.path()).ok())?;
    Some((eml, der))
}

#[test]
fn dkim_verifies_against_dns_key() {
    let Some((eml, der)) = load() else { eprintln!("skipped: no private .eml"); return };
    let v = dkim::verify(&eml, &der).expect("DKIM must verify");
    assert_eq!(v.domain, "ileti.ziraatbank.com.tr");
    assert_eq!(v.selector, "msg2");
    assert_eq!(dkim::header_address_domain(&v.headers, "from").as_deref(), Some("ileti.ziraatbank.com.tr"));
}

#[test]
fn dkim_rejects_tampered_body_and_wrong_key() {
    let Some((eml, der)) = load() else { return };
    let mut bad = eml.clone();
    let l = bad.len();
    bad[l - 200] ^= 0x01; // inside the base64 attachment
    assert_eq!(dkim::verify(&bad, &der).unwrap_err(), dkim::DkimError::BodyHashMismatch);
    let mut wrong_key = der.clone();
    wrong_key[60] ^= 0x01; // flip a modulus bit
    assert!(matches!(dkim::verify(&eml, &wrong_key), Err(dkim::DkimError::SignatureInvalid) | Err(dkim::DkimError::BadPublicKey)));
}

#[test]
fn statement_rows_parse_and_fast_row_is_found() {
    let Some((eml, _)) = load() else { return };
    let (h, b) = dkim::split_message(&eml);
    let headers = dkim::parse_headers(&h);
    let html = mime::extract_statement_html(&headers, &b).expect("attachment");
    let st = statement::parse(&html).expect("statement");
    assert_eq!(st.currency, "TRY");
    assert!(st.account_iban.starts_with("TR"));
    assert!(st.rows.len() > 10, "rows: {}", st.rows.len());
    let fast = st.rows.iter().find(|r| r.description.contains("FAST")).expect("a FAST row");
    assert!(fast.amount_kurus < 0);
    assert!(fast.recipient_iban().is_some(), "{}", fast.description);
    println!("FAST row: {:?}", fast);
}

#[test]
fn prove_payment_produces_consistent_public_values() {
    let Some((eml, der)) = load() else { return };
    let (h, b) = dkim::split_message(&eml);
    let headers = dkim::parse_headers(&h);
    let html = mime::extract_statement_html(&headers, &b).unwrap();
    let st = statement::parse(&html).unwrap();
    let (idx, row) = st.rows.iter().enumerate().find(|(_, r)| r.description.contains("FAST")).unwrap();
    let iban = row.recipient_iban().unwrap();

    let input = ProverInput { eml: eml.clone(), dkim_pubkey_der: der.clone(), row_index: idx as u32, offer_id: 42 };
    let claim = prove_payment(&input).expect("prove_payment");
    assert_eq!(claim.offer_id, 42);
    assert_eq!(claim.amount_kurus, row.amount_kurus.unsigned_abs());
    assert_eq!(claim.date_yyyymmdd, row.date_yyyymmdd);
    assert_eq!(claim.recipient_iban_hash, iban_hash(&iban));
    assert_eq!(claim.domain_hash, sha256(b"ileti.ziraatbank.com.tr"));
    assert_eq!(claim.dkim_key_hash, sha256(&der));
    let bytes = claim.to_bytes();
    assert_eq!(PaymentClaim::from_bytes(&bytes).unwrap(), claim);

    // host helper picks the same row
    let found = find_payment_row(&eml, &iban, 1, 20260101).unwrap().unwrap();
    assert_eq!(found.0, idx as u32);
    // a POS row is not an acceptable payment
    let pos_idx = st.rows.iter().position(|r| r.description.starts_with("POS")).unwrap();
    let bad = ProverInput { row_index: pos_idx as u32, ..input.clone() };
    assert_eq!(prove_payment(&bad).unwrap_err(), Error::NoRecipientIban);
    println!("public values: {}", hex::encode(bytes));
}
