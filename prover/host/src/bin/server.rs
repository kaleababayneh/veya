//! zkotc-server: HTTP prover (RISC Zero backend).
//!
//!   POST /jobs   {eml_base64, offer_id, buyer, recipient_iban, recipient_name, min_amount_kurus, since_yyyymmdd}
//!   GET  /jobs/{id}
//!   GET  /info   {image_id, prover_mode, dkim_source, public_values_len}
//!   GET  /health
//!
//! Env: RISC0_DEV_MODE=1 (fake receipts, dev only), PORT (8787), DKIM_DNS=1, CORS_ORIGIN,
//!      PROVER_TOKEN (if set, `POST /jobs` requires header `x-prover-token`), MAX_JOBS_QUEUED (default 8),
//!      SUCCINCT_CACHE_DIR (keep STARK receipts so a failed Groth16 wrap can be retried with `zkotc wrap`),
//!      GROTH16_ICICLE_DIR + GROTH16_ZKEY_DIR (GPU hosts: ICICLE-snark GPU Groth16 worker, ~5 s wrap) or
//!      GROTH16_NATIVE_DIR (GPU hosts: reference CPU Groth16 prover unpacked from the risc0 docker image; no Docker).
//! The e-mail is held in memory only for the duration of the job; bodies are never logged.
use axum::{
    extract::{DefaultBodyLimit, Path, State},
    http::{HeaderMap, HeaderValue, Method, StatusCode},
    routing::{get, post},
    Json, Router,
};
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{mpsc, Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use tower_http::cors::{Any, CorsLayer};
use zkotc_host::{build_input, dev_mode, execute, image_id_hex, prove_groth16, resolve_dkim_der, ClaimJson, PINNED_DER};
use zkotc_lib::ProverInput;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum JobStatus {
    Queued,
    Executing,
    Proving,
    Done,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
struct Job {
    id: String,
    status: JobStatus,
    offer_id: u64,
    created_at: u64,
    updated_at: u64,
    dekont: Option<DekontJson>,
    claim: Option<ClaimJson>,
    public_values: Option<String>,
    journal_digest: Option<String>,
    proof: Option<String>,
    image_id: String,
    cycles: Option<u64>,
    error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct DekontJson {
    date_yyyymmdd: u64,
    time: String,
    fis_no: String,
    amount_kurus: u64,
    /// description with IBANs masked, for display only
    description: String,
    fast_sorgu_no: Option<String>,
    recipient_name: Option<String>,
}

#[derive(Deserialize)]
struct NewJob {
    eml_base64: String,
    offer_id: u64,
    /// claiming wallet; the dekont must carry payment_reference(offer_id, buyer)
    buyer: String,
    recipient_iban: String,
    #[serde(default)]
    recipient_name: String,
    #[serde(default = "one")]
    min_amount_kurus: u64,
    #[serde(default)]
    since_yyyymmdd: u64,
}
fn one() -> u64 {
    1
}

#[derive(Serialize)]
struct Info {
    image_id: String,
    prover_mode: String,
    dkim_source: String,
    public_values_len: usize,
}

type Jobs = Arc<Mutex<HashMap<String, Job>>>;

struct AppState {
    jobs: Jobs,
    tx: Mutex<mpsc::Sender<(String, ProverInput)>>,
    dkim_dns: bool,
    token: Option<String>,
    max_queued: usize,
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs()
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env().add_directive("info".parse()?))
        .init();
    let dkim_dns = std::env::var("DKIM_DNS").map(|v| v == "1" || v == "true").unwrap_or(false);
    let jobs: Jobs = Arc::new(Mutex::new(HashMap::new()));

    let (tx, rx) = mpsc::channel::<(String, ProverInput)>();
    {
        let jobs = jobs.clone();
        std::thread::spawn(move || {
            tracing::info!(image_id = %image_id_hex(), dev_mode = dev_mode(), groth16 = %zkotc_host::groth16_engine(), "prover ready");
            for (id, input) in rx {
                let set = |st: JobStatus, f: &dyn Fn(&mut Job)| {
                    if let Some(j) = jobs.lock().unwrap().get_mut(&id) {
                        j.status = st;
                        j.updated_at = now();
                        f(j);
                    }
                };
                set(JobStatus::Executing, &|_| {});
                let ex = match execute(&input) {
                    Ok(v) => v,
                    Err(e) => {
                        set(JobStatus::Failed, &|j| j.error = Some(format!("execution failed: {e}")));
                        continue;
                    }
                };
                set(JobStatus::Proving, &|j| {
                    j.cycles = Some(ex.total_cycles);
                    j.public_values = Some(format!("0x{}", hex::encode(&ex.journal)));
                    j.claim = Some(ClaimJson::from(&ex.claim));
                });
                let cache = std::env::var("SUCCINCT_CACHE_DIR").ok().map(|d| std::path::PathBuf::from(d).join(format!("{id}.succinct")));
                match prove_groth16(&input, cache.as_deref()) {
                    Ok(b) => set(JobStatus::Done, &|j| {
                        j.proof = Some(b.proof.clone());
                        j.public_values = Some(b.public_values.clone());
                        j.journal_digest = Some(b.journal_digest.clone());
                        j.cycles = Some(b.total_cycles);
                    }),
                    Err(e) => set(JobStatus::Failed, &|j| j.error = Some(format!("proving failed: {e}"))),
                }
                // `input` (the e-mail) is dropped here.
            }
        });
    }

    let token = std::env::var("PROVER_TOKEN").ok().filter(|t| !t.is_empty());
    let max_queued = std::env::var("MAX_JOBS_QUEUED").ok().and_then(|v| v.parse().ok()).unwrap_or(8);
    if token.is_none() {
        tracing::warn!("PROVER_TOKEN not set: POST /jobs is open to anyone");
    }
    let state = Arc::new(AppState { jobs: jobs.clone(), tx: Mutex::new(tx), dkim_dns, token, max_queued });
    let cors = match std::env::var("CORS_ORIGIN") {
        Ok(o) if o != "*" => CorsLayer::new()
            .allow_origin(o.split(',').map(|x| x.trim().parse::<HeaderValue>()).collect::<Result<Vec<_>, _>>()?)
            .allow_methods([Method::GET, Method::POST])
            .allow_headers(Any),
        _ => CorsLayer::new().allow_origin(Any).allow_methods([Method::GET, Method::POST]).allow_headers(Any),
    };
    let app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/info", get(info))
        .route("/jobs", post(create_job))
        .route("/jobs/{id}", get(get_job))
        .layer(DefaultBodyLimit::max(6 * 1024 * 1024))
        .layer(cors)
        .with_state(state);
    let port: u16 = std::env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(8787);
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port)).await?;
    tracing::info!(port, "zkotc-server listening");
    axum::serve(listener, app).await?;
    Ok(())
}

async fn info(State(st): State<Arc<AppState>>) -> Json<Info> {
    Json(Info {
        image_id: image_id_hex(),
        prover_mode: if dev_mode() { "dev (fake receipts)".into() } else { "groth16".into() },
        dkim_source: if st.dkim_dns { "dns".into() } else { "pinned".into() },
        public_values_len: zkotc_lib::PUBLIC_VALUES_LEN,
    })
}

async fn create_job(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<NewJob>,
) -> Result<(StatusCode, Json<Job>), (StatusCode, Json<serde_json::Value>)> {
    let bad = |m: String| (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": m })));
    if let Some(expected) = &st.token {
        let given = headers.get("x-prover-token").and_then(|v| v.to_str().ok()).unwrap_or("");
        if given != expected {
            return Err((StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "missing or invalid x-prover-token" }))));
        }
    }
    let queued = st.jobs.lock().unwrap().values().filter(|j| matches!(j.status, JobStatus::Queued | JobStatus::Executing | JobStatus::Proving)).count();
    if queued >= st.max_queued {
        return Err((StatusCode::TOO_MANY_REQUESTS, Json(serde_json::json!({ "error": format!("prover busy: {queued} jobs in progress, try again later") }))));
    }
    let eml = base64::engine::general_purpose::STANDARD.decode(req.eml_base64.trim()).map_err(|e| bad(format!("eml_base64: {e}")))?;
    if eml.len() > 2 * 1024 * 1024 {
        return Err(bad("e-mail larger than 2 MiB".into()));
    }
    let der = resolve_dkim_der(&eml, st.dkim_dns, Some(PINNED_DER)).await.map_err(|e| bad(format!("dkim key: {e}")))?;
    let (input, d) = build_input(eml, der, &req.recipient_iban, &req.recipient_name, req.min_amount_kurus, req.since_yyyymmdd, req.offer_id, &req.buyer).map_err(|e| bad(e.to_string()))?;
    // fail fast on the host with the exact same code the guest runs
    let claim = zkotc_lib::prove_payment(&input).map_err(|e| bad(format!("verification failed: {e}")))?;

    let id = uuid::Uuid::new_v4().to_string();
    let t = now();
    let job = Job {
        id: id.clone(),
        status: JobStatus::Queued,
        offer_id: req.offer_id,
        created_at: t,
        updated_at: t,
        dekont: Some(DekontJson {
            date_yyyymmdd: d.date_yyyymmdd,
            time: d.time.clone(),
            fis_no: d.fis_no.clone(),
            amount_kurus: d.amount_kurus,
            description: mask_ibans(&d.description),
            fast_sorgu_no: d.fast_sorgu_no().map(str::to_string),
            recipient_name: d.recipient_name().map(str::to_string),
        }),
        claim: Some(ClaimJson::from(&claim)),
        public_values: Some(format!("0x{}", hex::encode(claim.to_bytes()))),
        journal_digest: None,
        proof: None,
        image_id: image_id_hex(),
        cycles: None,
        error: None,
    };
    st.jobs.lock().unwrap().insert(id.clone(), job.clone());
    st.tx.lock().unwrap().send((id, input)).map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": "prover thread gone" }))))?;
    Ok((StatusCode::ACCEPTED, Json(job)))
}

async fn get_job(State(st): State<Arc<AppState>>, Path(id): Path<String>) -> Result<Json<Job>, StatusCode> {
    st.jobs.lock().unwrap().get(&id).cloned().map(Json).ok_or(StatusCode::NOT_FOUND)
}

fn mask_ibans(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let b = s.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if i + 26 <= b.len() && &b[i..i + 2] == b"TR" && b[i + 2..i + 26].iter().all(|c| c.is_ascii_digit()) {
            out.push_str(&format!("TR{}****{}", &s[i + 2..i + 6], &s[i + 22..i + 26]));
            i += 26;
        } else {
            let ch = s[i..].chars().next().unwrap();
            out.push(ch);
            i += ch.len_utf8();
        }
    }
    out
}
