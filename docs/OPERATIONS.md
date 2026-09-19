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
That is far too slow for users; the VM is fine as a build/verification box, but production proving needs a GPU host
(`cargo build --release --features cuda`, NVIDIA CUDA 12; RISC Zero reports roughly a minute per proof of this size)
or Boundless. Keep the VM's `zkotc-prover` for API testing only.

## Security notes
- `POST /jobs` requires `x-prover-token`; the token is public in the web bundle, so it only deters drive-by abuse. Real auth (SEP-10 wallet login) is on the roadmap.
- At most `MAX_JOBS_QUEUED` (8) jobs in flight; body limit 6 MiB; e-mails are kept only in memory for the job.
- Rotate the token: edit the unit file, `systemctl daemon-reload && systemctl restart zkotc-prover`, update `NEXT_PUBLIC_PROVER_TOKEN` and redeploy the web app.
