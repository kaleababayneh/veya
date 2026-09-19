//! zkotc CLI (RISC Zero) — evidence: a bank's DKIM-signed dekont e-mail (.eml): Ziraat (HTML) or VakıfBank (PDF)
//!   zkotc image-id
//!   zkotc execute --eml e-dekont.eml --iban TR.. --name "AD SOYAD" --offer-id 1 --buyer G… [--min-kurus N] [--since YYYYMMDD] [--dns]
//!   zkotc prove   --eml e-dekont.eml --iban TR.. --name "AD SOYAD" --offer-id 1 --buyer G… --out proof.json [--dns]
//!   zkotc reference --offer-id 1 --buyer G…      # the text the buyer must put in the FAST description
//! Env GROTH16_NATIVE_DIR=<dir>: Groth16 wrap with the reference CPU prover run natively (see host/src/lib.rs).
use anyhow::Result;
use clap::{Parser, Subcommand};
use zkotc_host::{build_input, execute, image_id_hex, prove_groth16, resolve_dkim_der, wrap_cached, ClaimJson, PINNED_DER};

#[derive(Parser)]
#[command(about = "RISC Zero zkEmail prover for Turkish FAST payments (Ziraat, VakıfBank)")]
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
    /// payee name as the bank records it (seller)
    #[arg(long)]
    name: String,
    #[arg(long)]
    offer_id: u64,
    /// claiming wallet (G…); the transfer description must carry `payment_reference(offer_id, buyer)`
    #[arg(long)]
    buyer: String,
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
    /// print the payment reference for an offer + wallet
    Reference {
        #[arg(long)]
        offer_id: u64,
        #[arg(long)]
        buyer: String,
    },
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
        Cmd::Reference { offer_id, buyer } => println!("{}", zkotc_lib::payment_reference(offer_id, &buyer)),
        Cmd::Execute(c) => {
            let (input, d) = prepare(&c)?;
            println!("dekont: {} {} {} amount {} debited {} {:?} sorgu {:?} payee {:?} @ bank {:?}", d.date_yyyymmdd, d.time, d.fis_no, d.amount_kurus, d.debited_kurus, d.direction, d.fast_sorgu_no(), d.recipient_name(), d.recipient_bank_code());
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

fn prepare(c: &Common) -> Result<(zkotc_lib::ProverInput, zkotc_lib::dekont::Dekont)> {
    let eml = std::fs::read(&c.eml)?;
    let rt = tokio::runtime::Runtime::new()?;
    let der = rt.block_on(resolve_dkim_der(&eml, c.dns, Some(PINNED_DER)))?;
    build_input(eml, der, &c.iban, &c.name, c.min_kurus, c.since, c.offer_id, &c.buyer)
}
