//! Host-side helpers shared by the CLI and the HTTP prover (RISC Zero backend).
use anyhow::{anyhow, Context, Result};
use base64::Engine;
use methods::{ZKOTC_GUEST_ELF, ZKOTC_GUEST_ID};
use risc0_ethereum_contracts::encode_seal;
use risc0_zkvm::{default_executor, default_prover, sha::Digest, ExecutorEnv, ProverOpts};
use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};
use zkotc_lib::{dkim, PaymentClaim, ProverInput};

/// Guest image id as 32 bytes (what the Soroban verifier receives).
pub fn image_id() -> [u8; 32] {
    let d: Digest = ZKOTC_GUEST_ID.into();
    d.as_bytes().try_into().unwrap()
}

pub fn image_id_hex() -> String {
    format!("0x{}", hex::encode(image_id()))
}

pub fn dev_mode() -> bool {
    std::env::var("RISC0_DEV_MODE").map(|v| v == "1" || v.eq_ignore_ascii_case("true")).unwrap_or(false)
}

/// Proof bundle: everything `otc-escrow.fulfill` needs.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProofBundle {
    pub image_id: String,
    /// guest journal = 152-byte public values (0x-hex)
    #[serde(rename = "publicValues")]
    pub public_values: String,
    /// sha256(journal) (0x-hex)
    pub journal_digest: String,
    /// Groth16 seal from `encode_seal` (0x-hex): 4-byte selector ‖ A ‖ B ‖ C
    pub proof: String,
    pub claim: ClaimJson,
    pub total_cycles: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaimJson {
    pub dkim_key_hash: String,
    pub domain_hash: String,
    pub recipient_iban_hash: String,
    pub amount_kurus: u64,
    pub date_yyyymmdd: u64,
    pub nullifier: String,
    pub offer_id: u64,
}

impl From<&PaymentClaim> for ClaimJson {
    fn from(c: &PaymentClaim) -> Self {
        ClaimJson {
            dkim_key_hash: hex::encode(c.dkim_key_hash),
            domain_hash: hex::encode(c.domain_hash),
            recipient_iban_hash: hex::encode(c.recipient_iban_hash),
            amount_kurus: c.amount_kurus,
            date_yyyymmdd: c.date_yyyymmdd,
            nullifier: hex::encode(c.nullifier),
            offer_id: c.offer_id,
        }
    }
}

pub struct Executed {
    pub journal: Vec<u8>,
    pub claim: PaymentClaim,
    pub total_cycles: u64,
}

/// Run the guest in the executor only (no proof). Works on any machine.
pub fn execute(input: &ProverInput) -> Result<Executed> {
    let env = ExecutorEnv::builder().write(input)?.build()?;
    let session = default_executor().execute(env, ZKOTC_GUEST_ELF)?;
    let journal = session.journal.bytes.clone();
    let claim = PaymentClaim::from_bytes(&journal).ok_or(anyhow!("journal is not 152 bytes"))?;
    let total_cycles = session.segments.iter().map(|s| s.cycles as u64).sum();
    Ok(Executed { journal, claim, total_cycles })
}

/// Prove with Groth16 (x86 + `rzup install risc0-groth16`, or `RISC0_DEV_MODE=1` for a fake receipt).
pub fn prove_groth16(input: &ProverInput) -> Result<ProofBundle> {
    let env = ExecutorEnv::builder().write(input)?.build()?;
    let info = default_prover().prove_with_opts(env, ZKOTC_GUEST_ELF, &ProverOpts::groth16())?;
    let receipt = info.receipt;
    receipt.verify(ZKOTC_GUEST_ID).context("receipt verification")?;
    let journal = receipt.journal.bytes.clone();
    let claim = PaymentClaim::from_bytes(&journal).ok_or(anyhow!("journal is not 152 bytes"))?;
    let seal = encode_seal(&receipt).context("encode_seal")?;
    Ok(ProofBundle {
        image_id: image_id_hex(),
        public_values: format!("0x{}", hex::encode(&journal)),
        journal_digest: format!("0x{}", hex::encode(Sha256::digest(&journal))),
        proof: format!("0x{}", hex::encode(seal)),
        claim: ClaimJson::from(&claim),
        total_cycles: info.stats.total_cycles,
    })
}

/// Fetch the DKIM public key (DER SubjectPublicKeyInfo) from DNS TXT `<selector>._domainkey.<domain>`.
pub async fn fetch_dkim_der(selector: &str, domain: &str) -> Result<Vec<u8>> {
    use hickory_resolver::TokioAsyncResolver;
    let resolver = TokioAsyncResolver::tokio_from_system_conf().context("dns resolver")?;
    let name = format!("{selector}._domainkey.{domain}.");
    let txt = resolver.txt_lookup(name.clone()).await.with_context(|| format!("TXT {name}"))?;
    for record in txt.iter() {
        let joined: String = record.txt_data().iter().map(|b| String::from_utf8_lossy(b).to_string()).collect::<Vec<_>>().join("");
        for tag in joined.split(';') {
            if let Some((k, v)) = tag.trim().split_once('=') {
                if k.trim() == "p" {
                    let clean: String = v.chars().filter(|c| !c.is_whitespace()).collect();
                    return base64::engine::general_purpose::STANDARD.decode(clean).context("p= base64");
                }
            }
        }
    }
    Err(anyhow!("no p= tag in {name}"))
}

pub async fn resolve_dkim_der(eml: &[u8], dns: bool, pinned_der: Option<&[u8]>) -> Result<Vec<u8>> {
    if dns {
        let (s, d) = dkim::selector_and_domain(eml).ok_or(anyhow!("no DKIM-Signature header"))?;
        fetch_dkim_der(&s, &d).await
    } else {
        pinned_der.map(|d| d.to_vec()).ok_or(anyhow!("no pinned DKIM key"))
    }
}

/// Build the guest input for the statement row paying `recipient_iban`.
pub fn build_input(
    eml: Vec<u8>,
    der: Vec<u8>,
    recipient_iban: &str,
    min_amount_kurus: u64,
    since_yyyymmdd: u64,
    offer_id: u64,
) -> Result<(ProverInput, zkotc_lib::statement::Row)> {
    let (idx, row) = zkotc_lib::find_payment_row(&eml, recipient_iban, min_amount_kurus, since_yyyymmdd)
        .map_err(|e| anyhow!("statement: {e}"))?
        .ok_or_else(|| anyhow!("no outgoing transfer of at least {min_amount_kurus} kuruş to {recipient_iban} on/after {since_yyyymmdd} found in this statement"))?;
    Ok((ProverInput { eml, dkim_pubkey_der: der, row_index: idx, offer_id }, row))
}

pub const PINNED_DER: &[u8] = include_bytes!("../../../zkotc-lib/testdata/ziraat-ileti-msg2.der");
