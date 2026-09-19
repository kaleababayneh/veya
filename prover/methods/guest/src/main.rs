//! RISC Zero guest: verify the Ziraat e-dekont e-mail and commit the 152-byte payment claim.
//!
//! Input protocol (must match `zkotc_host::executor_env`): for each byte blob (e-mail, DKIM key
//! DER) a `u32` length followed by the raw bytes via `read_slice`, then serde-encoded `offer_id`, the
//! attachment hint (host-located, guest-verified offsets of the e-dekont part) and the payment reference
//! the buyer typed into the transfer (bound into the journal as `reference_hash`). Bulk `read_slice` is far
//! cheaper than deserializing a `Vec<u8>` element by element (which cost ~20M of 34M cycles).
use risc0_zkvm::guest::env;
use zkotc_lib::{mime::AttachmentHint, prove_payment, ProverInput};

fn main() {
    let eml = read_blob();
    let dkim_pubkey_der = read_blob();
    let offer_id: u64 = env::read();
    let attachment: Option<AttachmentHint> = env::read();
    let reference: String = env::read();
    let input = ProverInput { eml, dkim_pubkey_der, offer_id, attachment, reference };
    let claim = prove_payment(&input).expect("payment verification failed");
    env::commit_slice(&claim.to_bytes());
}

fn read_blob() -> Vec<u8> {
    let len: u32 = env::read();
    let mut buf = vec![0u8; len as usize];
    env::read_slice(&mut buf);
    buf
}
