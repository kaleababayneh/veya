# Operations — prover host

| item | value |
|---|---|
| Host | Azure VM `kaleab5`, Ubuntu 24.04, 4 vCPU x86_64 (Xeon 8171M), 15 GB RAM, 2 TB disk, no GPU |
| SSH | `ssh kaleab@4.239.243.216` |
| Public URL | `https://4-239-243-216.sslip.io` (Caddy 2, Let's Encrypt, reverse proxy → `127.0.0.1:8787`) |
| Service | `zkotc-prover.service` (systemd) → `/home/kaleab/zkotc/prover/target/release/zkotc-server` |
| Env | `PORT=8787 DKIM_DNS=1 SUCCINCT_CACHE_DIR=/home/kaleab/zkotc/cache CORS_ORIGIN=https://zkotc.vercel.app,http://localhost:3000 PROVER_TOKEN=<secret>` (set in the unit file; the same token is `NEXT_PUBLIC_PROVER_TOKEN` in the web env) |
| Toolchain | rustup stable, `rzup` (cargo-risczero / r0vm 3.0.6, rust 1.97, `risc0-groth16`), Docker (the Groth16 wrap runs `risczero/risc0-groth16-prover:v2025-04-03.1`; user in the `docker` group) |
| Firewall | ufw: 22, 80, 443 only |
| Source | `~/zkotc/{zkotc-lib,prover}` synced with `rsync` from the repo (see below) |

## Deploy / update
```sh
# from the repo root on your machine
rsync -az --delete --exclude target/ --exclude build.log --exclude .git/ zkotc-lib prover kaleab@4.239.243.216:~/zkotc/
ssh kaleab@4.239.243.216 'source ~/.cargo/env; export PATH=$HOME/.risc0/bin:$PATH; cd ~/zkotc/prover && cargo build --release && sudo systemctl restart zkotc-prover'
curl https://4-239-243-216.sslip.io/info      # image_id must equal the escrow's config.image_id
```
If `image_id` changed (any change to `zkotc-lib` or the guest): `stellar contract invoke --id <escrow> -- set_config … --image_id <new>`.

**The escrow's `image_id` must be the id reported by the prover host** (`/info`). Guest builds are only reproducible
across machines with `RISC0_USE_DOCKER=1` (Docker is not installed on the VM); a Mac build yields a different id.

## Operate
```sh
sudo systemctl status zkotc-prover; sudo journalctl -u zkotc-prover -f      # logs (no e-mail bodies)
sudo systemctl status caddy; sudo journalctl -u caddy -f
~/zkotc/prover/target/release/zkotc prove --eml x.eml --iban TR... --offer-id N --dns --out proof.json   # manual proof
```
Proving is two-phase: succinct STARK receipt (cached per job in `SUCCINCT_CACHE_DIR`, or `--succinct-cache` on the CLI) →
Groth16 wrap in Docker. If the wrap fails, retry it without redoing the STARK: `zkotc wrap --succinct <file> --out proof.json`.

**Measured on this 4-vCPU VM: the STARK phase of one 6.7M-cycle proof (old statement guest) took ~1h45m (15:49→17:34 on 2026-09-08).**
That is far too slow for users; the VM is fine as a build/verification box. **Production proving runs on a GPU host (below).**
Full e-dekont proof on the VM: 84 min (STARK) + 352 s (Docker Groth16 wrap on 4 vCPU).

## GPU host (Vast.ai RTX 4090) — 15 s per proof
Measured 2026-09-09 on a Vast.ai container (RTX 4090 24 GB, 32 vCPU EPYC 7742, driver 595, CUDA 12.8, Ubuntu 24.04, $0.36/h),
`zkotc-server` with the `icicle` engine, warm worker:

| phase | time |
|---|---|
| execute (no proof) | 0.3 s |
| STARK + succinct receipt (GPU), 2.6M cycles, 3 segments | 4.8 s |
| identity_p254 (GPU) | 0.3 s |
| Groth16 witness (`circom-witnesscalc` in-process, graph cached) | 2–4 s |
| Groth16 prover (ICICLE-snark worker, GPU; 4 s cold) | 2.3 s |
| **`POST /jobs` → `done`** | **15 s** (2 s of that is the client's poll interval) |

Engines (`docs/GPU.md`): `icicle` (default: `GROTH16_ICICLE_DIR` + `GROTH16_ZKEY_DIR`) or `native` (`GROTH16_NATIVE_DIR`,
reference CPU prover: witness 7 s + prover 12 s → 30 s per proof). Guest history: 5.19M → 2.06M cycles (see git log da7d23b).

**Why not risc0's CUDA wrap:** with `--features cuda`, risc0 3.0.5/3.0.6 wraps to Groth16 with its CUDA/sppark prover, which
crashes deterministically (`sppark_error: an illegal memory access`, [risc0#3785](https://github.com/risc0/risc0/issues/3785);
also produced invalid proofs at opt-level ≥ 1, [#3760](https://github.com/risc0/risc0/issues/3760)). The fix is only in the
unreleased 5.0.0-rc.1, whose verifier parameters the Stellar router does not carry. So `zkotc-host` has a `native-groth16`
engine (on with `cuda`): `GROTH16_NATIVE_DIR=<dir>` runs the *reference* CPU prover from `risczero/risc0-groth16-prover:v2025-04-03.1`
natively — identity_p254 on GPU → seal JSON → `stark_verify` (circom witness) → `prover` (Groth16). Same pipeline risc0 runs in Docker,
just without Docker (Vast containers cannot run one). 19 s vs 352 s on the Azure VM.

Setup (≈45 min, once per box; keep `~/zkotc/prover/target` if you re-rent):
```sh
apt-get install -y build-essential pkg-config libssl-dev clang rsync protobuf-compiler libgmp10 time
curl -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal;  curl -sL https://risczero.com/install | bash
rzup install rust; rzup install cargo-risczero 3.0.6; rzup install r0vm 3.0.6; rzup install risc0-groth16   # 5 GB
# the Groth16 tools: on a machine with Docker —
docker create --name g16 risczero/risc0-groth16-prover:v2025-04-03.1
docker cp g16:/app/. g16/; docker cp g16:/usr/local/bin/prover g16/; docker cp g16:/usr/local/bin/stark_verify g16/   # 2.5 GB
rsync -a g16/ root@<gpu-box>:~/g16/
# build (27 min on 32 vCPU: nvcc for rv32im + recursion kernels) and run
rsync -az --exclude target/ zkotc-lib prover root@<gpu-box>:~/zkotc/
cd ~/zkotc/prover && cargo build --release --features cuda
GROTH16_NATIVE_DIR=$HOME/g16 DKIM_DNS=1 PORT=10100 SUCCINCT_CACHE_DIR=$HOME/zkotc/cache CORS_ORIGIN=http://localhost:3000 \
  PROVER_TOKEN=<secret> nohup target/release/zkotc-server > server.log 2>&1 &
```
Vast maps container ports to public ones (`env | grep VAST_TCP_PORT_`; 8080/8384/6006/1111 are taken by the portal). The API is plain
HTTP on `http://<PUBLIC_IPADDR>:$VAST_TCP_PORT_10100`. The guest **image id differs from the Azure build** (not reproducible without
`RISC0_USE_DOCKER=1`): switch the escrow with `set_config --image_id <GET /info>` when the app points at this prover.
Gotchas: the rzup `r0vm` is CPU-only (hence the source build); `vastai/base-image` lacks `protoc`; appending to `authorized_keys` needs a
leading newline (the file has none); never pipe the prover's output through a long ssh pipeline — log to a file and poll.

## Security notes
- `POST /jobs` requires `x-prover-token`; the token is public in the web bundle, so it only deters drive-by abuse. Real auth (SEP-10 wallet login) is on the roadmap.
- At most `MAX_JOBS_QUEUED` (8) jobs in flight; body limit 6 MiB; e-mails are kept only in memory for the job.
- Rotate the token: edit the unit file, `systemctl daemon-reload && systemctl restart zkotc-prover`, update `NEXT_PUBLIC_PROVER_TOKEN` and redeploy the web app.
