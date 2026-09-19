//! Host-side helpers shared by the CLI and the HTTP prover (RISC Zero backend).
use anyhow::{anyhow, Context, Result};
use base64::Engine;
use methods::{ZKOTC_GUEST_ELF, ZKOTC_GUEST_ID};
use risc0_ethereum_contracts::encode_seal;
use risc0_zkvm::{default_executor, default_prover, sha::Digest, ExecutorEnv, ProverOpts, Receipt};
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
    pub payee_hash: String,
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
            payee_hash: hex::encode(c.payee_hash),
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

/// Guest input protocol: `u32` length + raw bytes (`write_slice`) for each blob, then serde for
/// the two scalars. Must match `methods/guest/src/main.rs`.
pub fn executor_env(input: &ProverInput) -> Result<ExecutorEnv<'static>> {
    Ok(ExecutorEnv::builder()
        .write(&(input.eml.len() as u32))?
        .write_slice(&input.eml)
        .write(&(input.dkim_pubkey_der.len() as u32))?
        .write_slice(&input.dkim_pubkey_der)
        .write(&input.offer_id)?
        .build()?)
}

/// Run the guest in the executor only (no proof). Works on any machine.
pub fn execute(input: &ProverInput) -> Result<Executed> {
    let env = executor_env(input)?;
    let session = default_executor().execute(env, ZKOTC_GUEST_ELF)?;
    let journal = session.journal.bytes.clone();
    let claim = PaymentClaim::from_bytes(&journal).ok_or(anyhow!("journal is not 152 bytes"))?;
    let total_cycles = session.segments.iter().map(|s| s.cycles as u64).sum();
    Ok(Executed { journal, claim, total_cycles })
}

/// Prove in two phases: a succinct STARK receipt (the expensive part, optionally cached at
/// `succinct_cache`), then the Groth16 wrap (`rzup install risc0-groth16` + Docker on x86_64, or
/// `RISC0_DEV_MODE=1` for a fake receipt). A cached succinct receipt is reused if present, so a
/// failed wrap never costs the STARK again.
pub fn prove_groth16(input: &ProverInput, succinct_cache: Option<&std::path::Path>) -> Result<ProofBundle> {
    let prover = default_prover();
    let (succinct, total_cycles) = match succinct_cache.filter(|p| p.exists()) {
        Some(path) => {
            let receipt: Receipt = bincode::deserialize(&std::fs::read(path)?)?;
            receipt.verify(ZKOTC_GUEST_ID).context("cached succinct receipt")?;
            (receipt, 0)
        }
        None => {
            let env = executor_env(input)?;
            let info = prover.prove_with_opts(env, ZKOTC_GUEST_ELF, &ProverOpts::succinct())?;
            if let Some(path) = succinct_cache {
                std::fs::write(path, bincode::serialize(&info.receipt)?)?;
            }
            (info.receipt, info.stats.total_cycles)
        }
    };
    let receipt = wrap_groth16(&succinct)?;
    bundle(&receipt, total_cycles)
}

/// Groth16 wrap of a succinct receipt (docker + risc0-groth16 on x86_64).
pub fn wrap_groth16(succinct: &Receipt) -> Result<Receipt> {
    let receipt = default_prover().compress(&ProverOpts::groth16(), succinct).context("groth16 wrap")?;
    receipt.verify(ZKOTC_GUEST_ID).context("receipt verification")?;
    Ok(receipt)
}

fn bundle(receipt: &Receipt, total_cycles: u64) -> Result<ProofBundle> {
    let journal = receipt.journal.bytes.clone();
    let claim = PaymentClaim::from_bytes(&journal).ok_or(anyhow!("journal is not 152 bytes"))?;
    let seal = encode_seal(receipt).context("encode_seal")?;
    Ok(ProofBundle {
        image_id: image_id_hex(),
        public_values: format!("0x{}", hex::encode(&journal)),
        journal_digest: format!("0x{}", hex::encode(Sha256::digest(&journal))),
        proof: format!("0x{}", hex::encode(seal)),
        claim: ClaimJson::from(&claim),
        total_cycles,
    })
}

/// Wrap a previously saved succinct receipt into a proof bundle.
pub fn wrap_cached(succinct_path: &std::path::Path) -> Result<ProofBundle> {
    let succinct: Receipt = bincode::deserialize(&std::fs::read(succinct_path)?)?;
    let receipt = wrap_groth16(&succinct)?;
    bundle(&receipt, 0)
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

/// Validate the dekont on the host (same parser as the guest) and build the guest input.
/// Fails fast with a precise message when the e-mail cannot settle this offer.
pub fn build_input(
    eml: Vec<u8>,
    der: Vec<u8>,
    recipient_iban: &str,
    recipient_name: &str,
    min_amount_kurus: u64,
    since_yyyymmdd: u64,
    offer_id: u64,
) -> Result<(ProverInput, zkotc_lib::dekont::Dekont)> {
    let d = zkotc_lib::inspect_dekont(&eml).map_err(|e| anyhow!("dekont: {e}"))?;
    if d.direction != zkotc_lib::dekont::Direction::Outgoing {
        return Err(anyhow!("this dekont is an incoming transfer; upload the dekont of the transfer you sent"));
    }
    let want = zkotc_lib::payee::payee_hash_from_full(recipient_iban, recipient_name)
        .ok_or_else(|| anyhow!("seller IBAN is not a valid Turkish IBAN"))?;
    match d.payee_hash() {
        None => return Err(anyhow!("the dekont does not show the recipient account, bank and name")),
        Some(h) if h != want => {
            return Err(anyhow!(
                "the dekont's recipient ({} at bank {}, account {}) does not match the seller",
                d.recipient_name().unwrap_or("?"),
                d.recipient_bank_code().unwrap_or("?"),
                d.recipient_iban_masked().unwrap_or("?")
            ))
        }
        Some(_) => {}
    }
    if d.amount_kurus < min_amount_kurus {
        return Err(anyhow!("transfer of {} kuruş is below the offer amount of {min_amount_kurus} kuruş", d.amount_kurus));
    }
    if d.date_yyyymmdd < since_yyyymmdd {
        return Err(anyhow!("transfer dated {} is before the reservation day {since_yyyymmdd}", d.date_yyyymmdd));
    }
    Ok((ProverInput { eml, dkim_pubkey_der: der, offer_id }, d))
}

pub const PINNED_DER: &[u8] = include_bytes!("../../../zkotc-lib/testdata/ziraat-ileti-msg2.der");
