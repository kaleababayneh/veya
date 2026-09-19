# contracts

| crate | purpose |
|---|---|
| `escrow` | `zkotc-escrow`: offers, locks, settlement on a verified RISC Zero receipt, nullifiers, fee, pause, upgrade |

The proof verifier is **not** in this repo: the escrow calls the RISC Zero verifier router from
[NethermindEth/stellar-risc0-verifier](https://github.com/NethermindEth/stellar-risc0-verifier), deployed with that
repo's `scripts/manage.sh` (build it with `RUSTUP_TOOLCHAIN=1.89.0`; the script needs `pip install tomli_w`).
Deployment state is copied to `risc0-verifier-deployment.toml`; ids are listed in `DEPLOYMENTS.md`.

```sh
cargo test                                   # 16 escrow tests (verifier stubbed)
cd escrow && stellar contract build          # target/wasm32v1-none/release/zkotc_escrow.wasm
./scripts/deploy-escrow-testnet.sh <image_id> # constructor: router, image id, DKIM key hash, tokens, lock, fee
```
Upgrade in place (admin): `stellar contract upload --wasm … ` then `invoke -- upgrade --new_wasm_hash <hash>`.
