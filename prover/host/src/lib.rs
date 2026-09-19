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
    let mut b = ExecutorEnv::builder();
    // segment size (log2 cycles; risc0 default 20). Larger segments = fewer lift/join steps on a big GPU.
    if let Some(po2) = std::env::var("ZKOTC_SEGMENT_PO2").ok().and_then(|v| v.parse::<usize>().ok()) {
        b.segment_limit_po2(po2 as u32);
    }
    Ok(b
        .write(&(input.eml.len() as u32))?
        .write_slice(&input.eml)
        .write(&(input.dkim_pubkey_der.len() as u32))?
        .write_slice(&input.dkim_pubkey_der)
        .write(&input.offer_id)?
        .write(&input.attachment)?
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
            let t = std::time::Instant::now();
            let info = prover.prove_with_opts(env, ZKOTC_GUEST_ELF, &ProverOpts::succinct())?;
            tracing::info!("stark+succinct: {:.1}s ({} segments, {} cycles)", t.elapsed().as_secs_f64(), info.stats.segments, info.stats.total_cycles);
            if let Some(path) = succinct_cache {
                std::fs::write(path, bincode::serialize(&info.receipt)?)?;
            }
            (info.receipt, info.stats.total_cycles)
        }
    };
    let receipt = wrap_groth16(&succinct)?;
    bundle(&receipt, total_cycles)
}

/// Groth16 wrap of a succinct receipt (x86_64 + `rzup install risc0-groth16`). Engine:
/// * `GROTH16_NATIVE_DIR=<dir>`: RISC Zero's reference CPU prover run natively — the binaries and
///   proving key from `risczero/risc0-groth16-prover:v2025-04-03.1` unpacked into `<dir>`, no Docker.
///   Needs the `native-groth16` feature (implied by `cuda`). This is the engine for GPU hosts: the
///   CUDA Groth16 wrap in risc0 3.0.x crashes / miscomputes (risc0/risc0#3785, #3760).
/// * otherwise `default_prover().compress` (Docker on a CPU host).
/// * `GROTH16_ICICLE_DIR=<dir>`: GPU Groth16 with Ingonyama's ICICLE-snark (MIT) kept alive as a worker
///   process (`<dir>/icicle-snark`, its `libicicle_*.so` and `backend/cuda/*.so`); the circom witness
///   is computed in-process from `GROTH16_ZKEY_DIR/stark_verify_graph.bin` and the proof from
///   `GROTH16_ZKEY_DIR/stark_verify_final.zkey` (the `rzup` `risc0-groth16` component files).
///   identity_p254 0.3 s + witness ~2 s + proof ~2.4 s on an RTX 4090. Takes precedence.
pub fn wrap_groth16(succinct: &Receipt) -> Result<Receipt> {
    let receipt = match (env_dir("GROTH16_ICICLE_DIR"), native_groth16_dir()) {
        (Some(dir), _) => wrap_groth16_icicle(succinct, &dir)?,
        (None, Some(dir)) => wrap_groth16_native(succinct, &dir)?,
        (None, None) => default_prover().compress(&ProverOpts::groth16(), succinct).context("groth16 wrap")?,
    };
    receipt.verify(ZKOTC_GUEST_ID).context("receipt verification")?;
    Ok(receipt)
}

/// `GROTH16_NATIVE_DIR`, if set.
pub fn native_groth16_dir() -> Option<std::path::PathBuf> {
    env_dir("GROTH16_NATIVE_DIR")
}

fn env_dir(name: &str) -> Option<std::path::PathBuf> {
    std::env::var_os(name).filter(|v| !v.is_empty()).map(std::path::PathBuf::from)
}

/// Human-readable engine name for logs and `/info`.
pub fn groth16_engine() -> String {
    match (env_dir("GROTH16_ICICLE_DIR"), native_groth16_dir()) {
        (Some(d), _) => format!("icicle-gpu:{}", d.display()),
        (None, Some(d)) => format!("native-cpu:{}", d.display()),
        (None, None) => "default".into(),
    }
}

/// Scratch dir for wrap files: RAM-backed `/dev/shm` when present (the witness is 180 MB), else the temp dir.
#[cfg(feature = "native-groth16")]
fn groth16_work_dir() -> Result<(std::path::PathBuf, bool)> {
    if let Some(keep) = env_dir("ZKOTC_GROTH16_WORK_DIR") {
        std::fs::create_dir_all(&keep)?;
        return Ok((keep, true));
    }
    let base = std::path::Path::new("/dev/shm");
    let base = if base.is_dir() { base.to_path_buf() } else { std::env::temp_dir() };
    let work = base.join(format!("zkotc-groth16-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&work)?;
    Ok((work, false))
}

/// Groth16 receipt from a snarkjs-style `proof.json` (what both the reference prover and ICICLE write).
#[cfg(feature = "native-groth16")]
fn receipt_from_proof_json(succinct: &Receipt, proof_path: &std::path::Path) -> Result<Receipt> {
    use risc0_groth16::{ProofJson, Seal};
    use risc0_zkvm::{sha::Digestible, Groth16Receipt, Groth16ReceiptVerifierParameters, InnerReceipt};
    let inner = succinct.inner.succinct().map_err(|e| anyhow!("not a succinct receipt: {e:?}"))?;
    let proof: ProofJson = serde_json::from_str(&std::fs::read_to_string(proof_path)?)?;
    let seal: Seal = proof.try_into()?;
    let g16 = Groth16Receipt::new(seal.to_vec(), inner.claim.clone(), Groth16ReceiptVerifierParameters::default().digest());
    Ok(Receipt::new(InnerReceipt::Groth16(g16), succinct.journal.bytes.clone()))
}

/// identity_p254 on the prover's device → the circom input JSON for the `stark_verify` circuit.
#[cfg(feature = "native-groth16")]
fn identity_p254_input_json(succinct: &Receipt) -> Result<String> {
    use risc0_zkvm::recursion::identity_p254;
    let inner = succinct.inner.succinct().map_err(|e| anyhow!("not a succinct receipt: {e:?}"))?;
    let t = std::time::Instant::now();
    let ident = identity_p254(inner).context("identity_p254")?;
    tracing::info!("identity_p254: {:.1}s", t.elapsed().as_secs_f64());
    risc0_groth16::prove::to_json(&ident.get_seal_bytes())
}

#[cfg(feature = "native-groth16")]
mod icicle {
    //! A long-lived `icicle-snark` CLI worker: it parses the 3.6 GB zkey once and keeps it cached on the GPU
    //! (~8 GB VRAM, <1 GB RAM), so a proof costs ~2.4 s instead of ~4 s. Protocol: one `prove …` line on stdin,
    //! then stdout lines until `COMMAND_COMPLETED`. If the worker dies mid-proof it is respawned next time.
    //! Note: the upstream CLI busy-loops on EOF, so it is stopped with `exit` and dies with us (PDEATHSIG).
    use anyhow::{anyhow, Context, Result};
    use std::io::{BufRead, BufReader, Write};
    use std::path::Path;
    use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
    use std::sync::{Mutex, OnceLock};

    pub struct Worker {
        child: Child,
        stdin: ChildStdin,
        stdout: BufReader<ChildStdout>,
    }

    impl Drop for Worker {
        fn drop(&mut self) {
            // ask nicely first (the CLI busy-loops on EOF, so never just close stdin), then make sure
            let _ = writeln!(self.stdin, "exit").and_then(|_| self.stdin.flush());
            for _ in 0..20 {
                if matches!(self.child.try_wait(), Ok(Some(_))) {
                    return;
                }
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }

    fn slot() -> &'static Mutex<Option<Worker>> {
        static W: OnceLock<Mutex<Option<Worker>>> = OnceLock::new();
        W.get_or_init(|| Mutex::new(None))
    }

    fn spawn(dir: &Path) -> Result<Worker> {
        let bin = dir.join("icicle-snark");
        let backend = dir.join("backend");
        let mut ld = format!("{}:{}", dir.display(), backend.join("cuda").display());
        if let Some(cur) = std::env::var_os("LD_LIBRARY_PATH") {
            ld = format!("{ld}:{}", cur.to_string_lossy());
        }
        let mut cmd = Command::new(&bin);
        cmd.env("ICICLE_BACKEND_INSTALL_DIR", &backend)
            .env("LD_LIBRARY_PATH", ld)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());
        #[cfg(target_os = "linux")]
        {
            use std::os::unix::process::CommandExt;
            // die with the server so a crash never leaves a spinning worker holding the GPU
            unsafe {
                cmd.pre_exec(|| {
                    libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL);
                    Ok(())
                });
            }
        }
        let mut child = cmd.spawn().with_context(|| format!("spawn {}", bin.display()))?;
        let stdin = child.stdin.take().unwrap();
        let stdout = BufReader::new(child.stdout.take().unwrap());
        tracing::info!("icicle-snark worker started (pid {})", child.id());
        Ok(Worker { child, stdin, stdout })
    }

    pub fn prove(dir: &Path, zkey: &Path, witness: &Path, proof: &Path, public: &Path) -> Result<()> {
        let mut guard = slot().lock().unwrap_or_else(|e| e.into_inner());
        if guard.is_none() {
            *guard = Some(spawn(dir)?);
        }
        let w = guard.as_mut().unwrap();
        let cmd = format!(
            "prove --witness {} --zkey {} --proof {} --public {} --device CUDA",
            witness.display(),
            zkey.display(),
            proof.display(),
            public.display()
        );
        let run = |w: &mut Worker| -> Result<()> {
            writeln!(w.stdin, "{cmd}")?;
            w.stdin.flush()?;
            let mut line = String::new();
            loop {
                line.clear();
                if w.stdout.read_line(&mut line)? == 0 {
                    return Err(anyhow!("icicle-snark worker exited"));
                }
                let l = line.trim_start_matches("> ").trim();
                if l.starts_with("proof took") {
                    tracing::info!("icicle {l}");
                } else if l.contains("COMMAND_COMPLETED") {
                    return Ok(());
                } else if !l.is_empty() && !l.starts_with("[INFO]") {
                    tracing::debug!("icicle: {l}");
                }
            }
        };
        match run(w) {
            Ok(()) => {
                if !proof.is_file() {
                    return Err(anyhow!("icicle-snark reported completion but wrote no proof"));
                }
                Ok(())
            }
            Err(e) => {
                *guard = None; // drop → kill; respawn on the next call
                Err(e)
            }
        }
    }
}

/// GPU Groth16 wrap: identity_p254 (GPU) → circom witness (in-process, graph cached) → ICICLE-snark (GPU).
#[cfg(feature = "native-groth16")]
fn wrap_groth16_icicle(succinct: &Receipt, dir: &std::path::Path) -> Result<Receipt> {
    use std::sync::OnceLock;
    use std::time::Instant;
    static GRAPH: OnceLock<Vec<u8>> = OnceLock::new();

    let zkey_dir = env_dir("GROTH16_ZKEY_DIR").ok_or_else(|| anyhow!("GROTH16_ZKEY_DIR is not set (stark_verify_final.zkey + stark_verify_graph.bin)"))?;
    let zkey = zkey_dir.join("stark_verify_final.zkey");
    for p in [dir.join("icicle-snark"), zkey.clone(), zkey_dir.join("stark_verify_graph.bin")] {
        if !p.is_file() {
            return Err(anyhow!("missing {}", p.display()));
        }
    }
    let inputs = identity_p254_input_json(succinct)?;

    let t = Instant::now();
    let graph = GRAPH.get_or_init(|| std::fs::read(zkey_dir.join("stark_verify_graph.bin")).expect("read stark_verify_graph.bin"));
    let witness = circom_witnesscalc::calc_witness(&inputs, graph).map_err(|e| anyhow!("groth16 witness: {e}"))?;
    tracing::info!("groth16 witness (in-process): {:.1}s", t.elapsed().as_secs_f64());

    let (work, keep) = groth16_work_dir()?;
    let result = (|| -> Result<Receipt> {
        let wtns = work.join("witness.wtns");
        let proof = work.join("proof.json");
        std::fs::write(&wtns, &witness)?;
        let t = Instant::now();
        icicle::prove(dir, &zkey, &wtns, &proof, &work.join("public.json"))?;
        tracing::info!("groth16 prover (icicle, gpu): {:.1}s", t.elapsed().as_secs_f64());
        receipt_from_proof_json(succinct, &proof)
    })();
    if !keep {
        let _ = std::fs::remove_dir_all(&work);
    }
    result
}

#[cfg(not(feature = "native-groth16"))]
fn wrap_groth16_icicle(_: &Receipt, _: &std::path::Path) -> Result<Receipt> {
    Err(anyhow!("GROTH16_ICICLE_DIR is set but this binary was built without the `native-groth16` feature"))
}

#[cfg(feature = "native-groth16")]
const NATIVE_GROTH16_FILES: [&str; 5] = ["stark_verify", "stark_verify.dat", "prover", "stark_verify.cs", "stark_verify_final.pk.dmp"];

/// Same pipeline as `risc0_groth16::prove::docker::shrink_wrap`, without the container:
/// identity_p254 (GPU) → seal JSON → circom witness (`stark_verify`) → Groth16 (`prover`, CPU).
#[cfg(feature = "native-groth16")]
fn wrap_groth16_native(succinct: &Receipt, tools: &std::path::Path) -> Result<Receipt> {
    use std::{process::Command, time::Instant};

    for f in NATIVE_GROTH16_FILES {
        if !tools.join(f).is_file() {
            return Err(anyhow!("GROTH16_NATIVE_DIR={}: missing {f}", tools.display()));
        }
    }
    let inputs = identity_p254_input_json(succinct)?;
    let (work, keep) = groth16_work_dir()?;
    let result = (|| -> Result<Receipt> {
        let input = work.join("input.json");
        let wtns = work.join("witness.wtns");
        let proof = work.join("proof.json");
        std::fs::write(&input, inputs)?;

        let t = Instant::now();
        // circom's generated witness generator wants a 16 MiB stack and loads `stark_verify.dat` from the cwd
        run("witness", Command::new("sh").current_dir(tools).arg("-c").arg("ulimit -s 16384 && exec ./stark_verify \"$0\" \"$1\"").arg(&input).arg(&wtns))?;
        tracing::info!("groth16 witness: {:.1}s", t.elapsed().as_secs_f64());

        let t = Instant::now();
        run("prover", Command::new(tools.join("prover")).current_dir(tools).arg("stark_verify.cs").arg("stark_verify_final.pk.dmp").arg(&wtns).arg(&proof))?;
        tracing::info!("groth16 prover (cpu): {:.1}s", t.elapsed().as_secs_f64());

        receipt_from_proof_json(succinct, &proof)
    })();
    if !keep {
        let _ = std::fs::remove_dir_all(&work);
    }
    result
}

#[cfg(not(feature = "native-groth16"))]
fn wrap_groth16_native(_: &Receipt, _: &std::path::Path) -> Result<Receipt> {
    Err(anyhow!("GROTH16_NATIVE_DIR is set but this binary was built without the `native-groth16` feature"))
}

#[cfg(feature = "native-groth16")]
fn run(what: &str, cmd: &mut std::process::Command) -> Result<()> {
    let out = cmd.output().with_context(|| format!("spawn groth16 {what}"))?;
    if !out.status.success() {
        let err: String = String::from_utf8_lossy(&out.stderr).chars().take(2000).collect();
        return Err(anyhow!("groth16 {what} failed ({}): {err}", out.status));
    }
    Ok(())
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
    // CRLF-normalize once here; the guest hashes the bytes as given and the hint offsets refer to them
    let eml = match zkotc_lib::dkim::normalized(&eml) {
        std::borrow::Cow::Borrowed(_) => eml,
        std::borrow::Cow::Owned(v) => v,
    };
    let (d, attachment) = zkotc_lib::locate_dekont(&eml).map_err(|e| anyhow!("dekont: {e}"))?;
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
    Ok((ProverInput { eml, dkim_pubkey_der: der, offer_id, attachment: Some(attachment) }, d))
}

pub const PINNED_DER: &[u8] = include_bytes!("../../../zkotc-lib/testdata/ziraat-ileti-msg2.der");
