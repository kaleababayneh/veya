//! zkotc-lib: logic shared by the RISC Zero guest and the host prover.
//!
//! Pipeline (`prove_payment`):
//! 1. DKIM-verify the raw `.eml` against the supplied RSA public key (RFC 6376, rsa-sha256).
//! 2. Require the `From:` domain to equal the DKIM `d=` domain.
//! 3. Extract the `e-dekont.html` attachment from the signed MIME body.
//! 4. Parse the per-transaction dekont; require an outgoing transfer that prints recipient account/bank/name.
//! 5. Emit 152-byte public values (see `PaymentClaim`).

pub mod dekont;
pub mod dkim;
pub mod mime;
pub mod payee;
pub mod text;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const PUBLIC_VALUES_LEN: usize = 152;
const NULLIFIER_DOMAIN: &[u8] = b"stellarpro/zkotc/nullifier/v3-dekont";
pub const DEKONT_ATTACHMENT_PREFIX: &str = "e-dekont";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProverInput {
    pub eml: Vec<u8>,
    /// DER SubjectPublicKeyInfo of the DKIM key (what the DNS `p=` tag base64-encodes)
    pub dkim_pubkey_der: Vec<u8>,
    pub offer_id: u64,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PaymentClaim {
    pub dkim_key_hash: [u8; 32],
    pub domain_hash: [u8; 32],
    /// payee binding hash (see `payee`): check digits + bank code + last 6 IBAN digits + folded name
    pub payee_hash: [u8; 32],
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
        out[64..96].copy_from_slice(&self.payee_hash);
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
            payee_hash: a32(64),
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
    Dekont(String),
    NotOutgoing,
    /// the dekont does not print recipient account/bank/name
    NoPayee,
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

    let attachment = mime::extract_html_attachment(&verified.headers, &verified.body, DEKONT_ATTACHMENT_PREFIX)
        .map_err(Error::Mime)?;
    let d = dekont::parse(&attachment).map_err(Error::Dekont)?;
    if d.direction != dekont::Direction::Outgoing {
        return Err(Error::NotOutgoing);
    }
    let payee_hash = d.payee_hash().ok_or(Error::NoPayee)?;

    let domain_hash = sha256(verified.domain.to_ascii_lowercase().as_bytes());
    Ok(PaymentClaim {
        dkim_key_hash: sha256(&input.dkim_pubkey_der),
        domain_hash,
        payee_hash,
        amount_kurus: d.amount_kurus,
        date_yyyymmdd: d.date_yyyymmdd,
        nullifier: nullifier(&domain_hash, &d),
        offer_id: input.offer_id,
    })
}

/// Unique per dekont: domain ‖ Fast Sorgu No ‖ payer account (as printed) ‖ date ‖ time ‖ fiş no ‖ amount ‖ description ‖ settlement.
fn nullifier(domain_hash: &[u8; 32], d: &dekont::Dekont) -> [u8; 32] {
    let mut n = Sha256::new();
    n.update(NULLIFIER_DOMAIN);
    n.update(domain_hash);
    n.update(d.fast_sorgu_no().unwrap_or("").as_bytes());
    n.update(sha256(d.account_iban.as_bytes()));
    n.update(d.date_yyyymmdd.to_be_bytes());
    n.update(d.time.as_bytes());
    n.update(d.fis_no.as_bytes());
    n.update(d.amount_kurus.to_be_bytes());
    n.update(sha256(d.description.as_bytes()));
    n.update(sha256(d.settlement.as_bytes()));
    n.finalize().into()
}

/// Host-side helper (not run in the guest): parse the dekont without DKIM verification so the
/// prover service can validate direction, payee and amount before queueing a proof.
pub fn inspect_dekont(eml: &[u8]) -> Result<dekont::Dekont, Error> {
    let (headers, body) = dkim::split_message(eml);
    let headers = dkim::parse_headers(&headers);
    let attachment = mime::extract_html_attachment(&headers, &body, DEKONT_ATTACHMENT_PREFIX).map_err(Error::Mime)?;
    dekont::parse(&attachment).map_err(Error::Dekont)
}
