//! zkotc-lib: logic shared by the RISC Zero guest and the host prover.
//!
//! Pipeline (`prove_payment`):
//! 1. DKIM-verify the raw `.eml` against the supplied RSA public key (RFC 6376, rsa-sha256).
//! 2. Require the `From:` domain to equal the DKIM `d=` domain.
//! 3. Extract the `e-dekont.html` attachment from the signed MIME body.
//! 4. Parse the per-transaction dekont; require an outgoing transfer that prints recipient account/bank/name.
//! 5. Require the payment reference (`ZKOTC<offer><code-of-buyer-wallet>`) in the transfer description, so
//!    the e-mail is bound to the claiming wallet and a stolen `.eml` settles nothing for anyone else.
//! 6. Emit 184-byte public values (see `PaymentClaim`).

pub mod dekont;
pub mod dkim;
pub mod mime;
pub mod payee;
pub mod pdf;
pub mod text;
pub mod vakif;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const PUBLIC_VALUES_LEN: usize = 184;
const NULLIFIER_DOMAIN: &[u8] = b"stellarpro/zkotc/nullifier/v3-dekont";
pub const DEKONT_ATTACHMENT_PREFIX: &str = "e-dekont";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProverInput {
    pub eml: Vec<u8>,
    /// DER SubjectPublicKeyInfo of the DKIM key (what the DNS `p=` tag base64-encodes)
    pub dkim_pubkey_der: Vec<u8>,
    pub offer_id: u64,
    /// where the e-dekont attachment sits in the body: computed by the host (`locate_dekont`), verified
    /// by the guest, so the guest never scans the body. `None` = scan (slow path, host tools).
    pub attachment: Option<mime::AttachmentHint>,
    /// the payment reference the buyer had to type into the FAST description (`payment_reference`)
    pub reference: String,
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
    /// sha256 of the folded payment reference found in the transfer description (`reference_hash`)
    pub reference_hash: [u8; 32],
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
        out[152..184].copy_from_slice(&self.reference_hash);
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
            reference_hash: a32(152),
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
    /// the transfer description does not contain the expected payment reference
    ReferenceMissing { expected: String },
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

/// The reference a buyer must type into the FAST description: `ZKOTC<offer id><6 hex of sha256(wallet)>`, one
/// token without spaces (easier to type on a phone; the last six characters are always the wallet part, so ids
/// of different lengths cannot collide).
/// Mirrored in the escrow (`payment_reference` view); the proof commits `reference_hash` of it.
pub fn payment_reference(offer_id: u64, buyer_address: &str) -> String {
    let h = sha256(buyer_address.trim().as_bytes());
    format!("ZKOTC{offer_id}{}", hex_upper(&h[..3]))
}

/// What the guest commits for a reference: sha256 of its folded form (uppercase, Turkish letters folded,
/// single spaces), so what the bank prints and what the wallet derived compare equal.
pub fn reference_hash(reference: &str) -> [u8; 32] {
    sha256(payee::fold_name(reference).as_bytes())
}

fn hex_upper(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02X}")).collect()
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

/// A bank whose DKIM-signed receipt e-mails the guest understands. Chosen from the DKIM `d=` domain, which
/// the signature itself authenticates; the escrow then checks the domain hash against its allow-list.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Provider {
    /// Ziraat Bankası: `e-dekont*.html` inside the signed body
    Ziraat,
    /// VakıfBank: `Dekont.pdf` inside the signed body
    Vakif,
}

impl Provider {
    pub fn for_domain(domain: &str) -> Option<Provider> {
        match domain.to_ascii_lowercase().as_str() {
            "ileti.ziraatbank.com.tr" => Some(Provider::Ziraat),
            vakif::DOMAIN => Some(Provider::Vakif),
            _ => None,
        }
    }
    /// (attachment name prefix, extension)
    pub fn attachment(&self) -> (&'static str, &'static str) {
        match self {
            Provider::Ziraat => (DEKONT_ATTACHMENT_PREFIX, ".html"),
            Provider::Vakif => (vakif::ATTACHMENT_PREFIX, vakif::ATTACHMENT_EXT),
        }
    }
    pub fn parse(&self, attachment: &[u8]) -> Result<dekont::Dekont, String> {
        match self {
            Provider::Ziraat => dekont::parse(attachment),
            Provider::Vakif => vakif::parse(attachment),
        }
    }
    pub fn name(&self) -> &'static str {
        match self {
            Provider::Ziraat => "Ziraat",
            Provider::Vakif => "VakıfBank",
        }
    }
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

    let provider = Provider::for_domain(&verified.domain).ok_or_else(|| Error::Mime(format!("unsupported bank domain {}", verified.domain)))?;
    let (prefix, ext) = provider.attachment();
    let hint = match input.attachment {
        Some(h) => h,
        None => mime::locate_attachment(&verified.headers, verified.body, prefix, ext)
            .ok_or_else(|| Error::Mime(format!("no {prefix}*{ext} attachment found")))?,
    };
    let payload = mime::attachment_at(&verified.headers, verified.body, hint, prefix, ext).map_err(Error::Mime)?;
    let attachment = mime::decode_base64_mime(payload).map_err(Error::Mime)?;
    let d = provider.parse(&attachment).map_err(Error::Dekont)?;
    if d.direction != dekont::Direction::Outgoing {
        return Err(Error::NotOutgoing);
    }
    let payee_hash = d.payee_hash().ok_or(Error::NoPayee)?;
    if !d.contains_reference(&input.reference) {
        return Err(Error::ReferenceMissing { expected: input.reference.clone() });
    }

    let domain_hash = sha256(verified.domain.to_ascii_lowercase().as_bytes());
    Ok(PaymentClaim {
        dkim_key_hash: sha256(&input.dkim_pubkey_der),
        domain_hash,
        payee_hash,
        amount_kurus: d.amount_kurus,
        date_yyyymmdd: d.date_yyyymmdd,
        nullifier: nullifier(&domain_hash, &d),
        offer_id: input.offer_id,
        reference_hash: reference_hash(&input.reference),
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
    locate_dekont(eml).map(|(d, _)| d)
}

/// Host helper: parse the dekont (no DKIM check) and locate its attachment for `ProverInput::attachment`.
/// `eml` must be CRLF-normalized (`dkim::normalized`) — the offsets refer to those bytes.
pub fn locate_dekont(eml: &[u8]) -> Result<(dekont::Dekont, mime::AttachmentHint), Error> {
    let (_, domain) = dkim::selector_and_domain(eml).ok_or_else(|| Error::Mime("no DKIM-Signature header".into()))?;
    let provider = Provider::for_domain(&domain).ok_or_else(|| Error::Mime(format!("unsupported bank domain {domain}")))?;
    let (prefix, ext) = provider.attachment();
    let (headers, body) = dkim::split_message(eml);
    let headers = dkim::parse_headers(headers);
    let hint = mime::locate_attachment(&headers, body, prefix, ext).ok_or_else(|| Error::Mime(format!("no {prefix}*{ext} attachment found")))?;
    let payload = mime::attachment_at(&headers, body, hint, prefix, ext).map_err(Error::Mime)?;
    let attachment = mime::decode_base64_mime(payload).map_err(Error::Mime)?;
    Ok((provider.parse(&attachment).map_err(Error::Dekont)?, hint))
}

/// Which bank sent `eml` (from its DKIM-Signature `d=`), for messages and UI; `None` = unsupported.
pub fn provider_of(eml: &[u8]) -> Option<Provider> {
    dkim::selector_and_domain(eml).and_then(|(_, d)| Provider::for_domain(&d))
}
