//! zkotc CLI (RISC Zero)
//!   zkotc image-id
//!   zkotc execute --eml statement.eml --iban TR.. --offer-id 1 [--min-kurus N] [--since YYYYMMDD] [--dns]
//!   zkotc prove   --eml statement.eml --iban TR.. --offer-id 1 --out proof.json [--dns]
use anyhow::Result;
use clap::{Parser, Subcommand};
use zkotc_host::{build_input, execute, image_id_hex, prove_groth16, resolve_dkim_der, wrap_cached, ClaimJson, PINNED_DER};

#[derive(Parser)]
#[command(about = "RISC Zero zkEmail prover for Ziraat FAST payments")]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(clap::Args)]
struct Common {
    #[arg(long)]
    eml: String,
    /// payee IBAN (seller)
    #[arg(long)]
    iban: String,
    #[arg(long)]
    offer_id: u64,
    #[arg(long, default_value_t = 1)]
    min_kurus: u64,
    #[arg(long, default_value_t = 20000101)]
    since: u64,
    /// fetch the DKIM key from DNS instead of the pinned Ziraat msg2 key
    #[arg(long)]
    dns: bool,
}

#[derive(Subcommand)]
enum Cmd {
    /// print the guest image id (bytes32) — the escrow's `image_id`
    ImageId,
    /// run the guest in the executor (no proof) and print the journal / public values
    Execute(Common),
    /// generate a Groth16 receipt (x86 + `rzup install risc0-groth16`; RISC0_DEV_MODE=1 gives a fake receipt)
    Prove {
        #[command(flatten)]
        common: Common,
        #[arg(long, default_value = "proof.json")]
        out: String,
        /// save/reuse the succinct STARK receipt here so a failed Groth16 wrap can be retried with `wrap`
        #[arg(long)]
        succinct_cache: Option<std::path::PathBuf>,
    },
    /// Groth16-wrap a saved succinct receipt (from `prove --succinct-cache`)
    Wrap {
        #[arg(long)]
        succinct: std::path::PathBuf,
        #[arg(long, default_value = "proof.json")]
        out: String,
    },
}

fn main() -> Result<()> {
    tracing_subscriber::fmt().with_env_filter(tracing_subscriber::EnvFilter::from_default_env()).init();
    dotenvy::dotenv().ok();
    match Cli::parse().cmd {
        Cmd::ImageId => println!("{}", image_id_hex()),
        Cmd::Execute(c) => {
            let (input, row) = prepare(&c)?;
            println!("row: {} {} {} {}", row.date_yyyymmdd, row.fis_no, row.amount_kurus, row.description);
            let ex = execute(&input)?;
            println!("image_id: {}", image_id_hex());
            println!("total_cycles: {}", ex.total_cycles);
            println!("public_values: 0x{}", hex::encode(&ex.journal));
            println!("{}", serde_json::to_string_pretty(&ClaimJson::from(&ex.claim))?);
        }
        Cmd::Prove { common, out, succinct_cache } => {
            let (input, _) = prepare(&common)?;
            let bundle = prove_groth16(&input, succinct_cache.as_deref())?;
            std::fs::write(&out, serde_json::to_string_pretty(&bundle)?)?;
            println!("wrote {out} (seal {} bytes, {} cycles)", (bundle.proof.len() - 2) / 2, bundle.total_cycles);
        }
        Cmd::Wrap { succinct, out } => {
            let bundle = wrap_cached(&succinct)?;
            std::fs::write(&out, serde_json::to_string_pretty(&bundle)?)?;
            println!("wrote {out} (seal {} bytes)", (bundle.proof.len() - 2) / 2);
        }
    }
    Ok(())
}

fn prepare(c: &Common) -> Result<(zkotc_lib::ProverInput, zkotc_lib::statement::Row)> {
    let eml = std::fs::read(&c.eml)?;
    let rt = tokio::runtime::Runtime::new()?;
    let der = rt.block_on(resolve_dkim_der(&eml, c.dns, Some(PINNED_DER)))?;
    build_input(eml, der, &c.iban, c.min_kurus, c.since, c.offer_id)
}
