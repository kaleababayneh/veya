//! RISC Zero guest: verify the Ziraat statement e-mail and commit the 152-byte payment claim.
use risc0_zkvm::guest::env;
use zkotc_lib::{prove_payment, ProverInput};

fn main() {
    let input: ProverInput = env::read();
    let claim = prove_payment(&input).expect("payment verification failed");
    env::commit_slice(&claim.to_bytes());
}
