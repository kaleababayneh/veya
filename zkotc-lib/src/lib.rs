//! zkotc-lib: logic shared by the SP1 guest and the host prover.
//!
//! Pipeline (`prove_payment`):
//! 1. DKIM-verify the raw `.eml` against the supplied RSA public key (RFC 6376, rsa-sha256).
//! 2. Require the `From:` domain to equal the DKIM `d=` domain.
//! 3. Extract the `Hesap_Hareketleri_*.html` attachment from the signed MIME body.
//! 4. Parse the Ziraat statement rows; select `row_index`.
//! 5. Emit 152-byte public values (see `PaymentClaim`).

pub mod dkim;
pub mod mime;
pub mod statement;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const PUBLIC_VALUES_LEN: usize = 152;
const NULLIFIER_DOMAIN: &[u8] = b"stellarpro/zkotc/nullifier/v1";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProverInput {
    pub eml: Vec<u8>,
    /// DER SubjectPublicKeyInfo of the DKIM key (what the DNS `p=` tag base64-encodes)
    pub dkim_pubkey_der: Vec<u8>,
    pub row_index: u32,
    pub offer_id: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PaymentClaim {
    pub dkim_key_hash: [u8; 32],
    pub domain_hash: [u8; 32],
    pub recipient_iban_hash: [u8; 32],
    pub amount_kurus: u64,
    pub date_yyyymmdd: u64,
    pub nullifier: [u8; 32],
    pub offer_id: u64,
}

impl PaymentClaim {
    pub fn to_bytes(&self) -> [u8; PUBLIC_VALUES_LEN] {
        let mut out = [0u8; PUBLIC_VALUES_LEN];
        out[0..32].copy_from_slice(&self.dkim_key_hash);
        out[32..64].copy_from_slice(&self.domain_hash);
        out[64..96].copy_from_slice(&self.recipient_iban_hash);
        out[96..104].copy_from_slice(&self.amount_kurus.to_be_bytes());
        out[104..112].copy_from_slice(&self.date_yyyymmdd.to_be_bytes());
        out[112..144].copy_from_slice(&self.nullifier);
        out[144..152].copy_from_slice(&self.offer_id.to_be_bytes());
        out
    }

    pub fn from_bytes(b: &[u8]) -> Option<Self> {
        if b.len() != PUBLIC_VALUES_LEN {
            return None;
        }
        let a32 = |s: usize| -> [u8; 32] { b[s..s + 32].try_into().unwrap() };
        let a8 = |s: usize| -> u64 { u64::from_be_bytes(b[s..s + 8].try_into().unwrap()) };
        Some(Self {
            dkim_key_hash: a32(0),
            domain_hash: a32(32),
            recipient_iban_hash: a32(64),
            amount_kurus: a8(96),
            date_yyyymmdd: a8(104),
            nullifier: a32(112),
            offer_id: a8(144),
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Error {
    Dkim(dkim::DkimError),
    FromDomainMismatch { from: String, dkim: String },
    Mime(String),
    Statement(String),
    RowOutOfRange(u32),
    NotOutgoing,
    NoRecipientIban,
}

impl core::fmt::Display for Error {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(f, "{:?}", self)
    }
}

impl From<dkim::DkimError> for Error {
    fn from(e: dkim::DkimError) -> Self {
        Error::Dkim(e)
    }
}

pub fn sha256(b: &[u8]) -> [u8; 32] {
    Sha256::digest(b).into()
}

/// Normalize an IBAN (uppercase, no spaces) and hash it — must match the escrow contract.
pub fn iban_hash(iban: &str) -> [u8; 32] {
    let norm: String = iban
        .chars()
        .filter(|c| !c.is_whitespace())
        .map(|c| c.to_ascii_uppercase())
        .collect();
    sha256(norm.as_bytes())
}

/// Parse the statement out of a (not yet verified) message: attachment → rows.
fn extract_statement(headers: &[dkim::Header], body: &[u8]) -> Result<statement::Statement, Error> {
    let attachment = mime::extract_statement_html(headers, body).map_err(Error::Mime)?;
    statement::parse(&attachment).map_err(Error::Statement)
}

/// Fully verified extraction; this is what the zkVM guest runs.
pub fn prove_payment(input: &ProverInput) -> Result<PaymentClaim, Error> {
    let verified = dkim::verify(&input.eml, &input.dkim_pubkey_der)?;

    let from_domain = dkim::header_address_domain(&verified.headers, "from")
        .ok_or_else(|| Error::Mime("missing From header".into()))?;
    if !from_domain.eq_ignore_ascii_case(&verified.domain) {
        return Err(Error::FromDomainMismatch {
            from: from_domain,
            dkim: verified.domain.clone(),
        });
    }

    let attachment = mime::extract_statement_html(&verified.headers, &verified.body).map_err(Error::Mime)?;
    let (account_iban, row) = statement::parse_row(&attachment, input.row_index as usize)
        .map_err(|e| if e.contains("out of range") { Error::RowOutOfRange(input.row_index) } else { Error::Statement(e) })?;
    let row = &row;
    if row.amount_kurus >= 0 {
        return Err(Error::NotOutgoing);
    }
    let recipient_iban = row.recipient_iban().ok_or(Error::NoRecipientIban)?;

    let domain_hash = sha256(verified.domain.to_ascii_lowercase().as_bytes());
    let amount_kurus = row.amount_kurus.unsigned_abs();

    Ok(PaymentClaim {
        dkim_key_hash: sha256(&input.dkim_pubkey_der),
        domain_hash,
        recipient_iban_hash: iban_hash(&recipient_iban),
        amount_kurus,
        date_yyyymmdd: row.date_yyyymmdd,
        nullifier: nullifier(&domain_hash, &account_iban, row),
        offer_id: input.offer_id,
    })
}

/// Unique per statement row: domain ‖ payer IBAN ‖ date ‖ fiş no ‖ amount ‖ description.
fn nullifier(domain_hash: &[u8; 32], account_iban: &str, row: &statement::Row) -> [u8; 32] {
    let mut n = Sha256::new();
    n.update(NULLIFIER_DOMAIN);
    n.update(domain_hash);
    n.update(iban_hash(account_iban));
    n.update(row.date_yyyymmdd.to_be_bytes());
    n.update(row.fis_no.as_bytes());
    n.update(row.amount_kurus.unsigned_abs().to_be_bytes());
    n.update(sha256(row.description.as_bytes()));
    n.finalize().into()
}

/// Host-side helper (not run in the guest): pick the row that pays `recipient_iban` at least
/// `min_amount_kurus` on/after `since_yyyymmdd`, without DKIM verification.
pub fn find_payment_row(
    eml: &[u8],
    recipient_iban: &str,
    min_amount_kurus: u64,
    since_yyyymmdd: u64,
) -> Result<Option<(u32, statement::Row)>, Error> {
    let (headers, body) = dkim::split_message(eml);
    let stmt = extract_statement(&dkim::parse_headers(&headers), &body)?;
    let want = iban_hash(recipient_iban);
    Ok(stmt.rows.into_iter().enumerate().find_map(|(i, row)| {
        let matches = row.amount_kurus < 0
            && row.amount_kurus.unsigned_abs() >= min_amount_kurus
            && row.date_yyyymmdd >= since_yyyymmdd
            && row.recipient_iban().is_some_and(|r| iban_hash(&r) == want);
        matches.then_some((i as u32, row))
    }))
}
