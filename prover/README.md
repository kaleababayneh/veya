# prover (RISC Zero)

| crate | role |
|---|---|
| `methods/guest` | zkVM guest `zkotc-guest`: `env::read::<ProverInput>()` → `prove_payment` → `env::commit_slice(journal)`; uses RISC Zero's accelerated `sha2`/`rsa` |
| `methods` | `risc0_build::embed_methods()` → `ZKOTC_GUEST_ELF`, `ZKOTC_GUEST_ID` |
| `host` | `zkotc` CLI (`image-id`, `execute`, `prove`) and `zkotc-server` (HTTP jobs API) on `risc0-zkvm` 3.0 |

```sh
curl -L https://risczero.com/install | bash && rzup install     # toolchain
cargo build --release
./target/release/zkotc image-id
./target/release/zkotc execute --eml my.eml --iban TR... --offer-id 1          # any machine
RISC0_DEV_MODE=1 ./target/release/zkotc prove --eml my.eml --iban TR... --offer-id 1   # fake receipt, dev only
rzup install risc0-groth16 && ./target/release/zkotc prove ...                  # real Groth16 receipt (x86_64)
PORT=8787 [DKIM_DNS=1] ./target/release/zkotc-server
```
Image ids are only reproducible across machines with `RISC0_USE_DOCKER=1`; the escrow must use the id of the
host that proves (see `docs/OPERATIONS.md`). The escrow expects receipts from risc0 3.0.x (control root pinned in the deployed verifier). Changing the guest changes
`image_id`; update the escrow with `set_config`.

## Profiling
```sh
go install github.com/google/pprof@latest
RISC0_PPROF_OUT=/tmp/zkotc.pprof ./target/release/zkotc execute --eml my.eml --iban TR... --offer-id 1
pprof -top -nodecount=30 /tmp/zkotc.pprof
```
Cycle history on a real statement: 33.7M → 13.4M (read blobs with `read_slice` instead of serde `Vec<u8>`)
→ 6.7M (parse only the requested statement row, per-line base64 decode, hash the DKIM body in place).
Remaining: MIME part scanning + base64 ≈ 5M, DKIM ≈ 1.5M (RSA/SHA-256 accelerated). Next candidates: a faster
substring search in `mime::split_parts` (`memchr::memmem`) and decoding only the statement part.
