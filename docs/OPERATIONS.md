# Operations — prover host

| item | value |
|---|---|
| Host | Azure VM `kaleab5`, Ubuntu 24.04, 4 vCPU x86_64 (Xeon 8171M), 15 GB RAM, 2 TB disk, no GPU |
| SSH | `ssh kaleab@4.239.243.216` |
| Public URL | `https://4-239-243-216.sslip.io` (Caddy 2, Let's Encrypt, reverse proxy → `127.0.0.1:8787`) |
| Service | `zkotc-prover.service` (systemd) → `/home/kaleab/zkotc/prover/target/release/zkotc-server` |
| Env | `PORT=8787 DKIM_DNS=1 CORS_ORIGIN=https://zkotc.vercel.app,http://localhost:3000 PROVER_TOKEN=<secret>` (set in the unit file; the same token is `NEXT_PUBLIC_PROVER_TOKEN` in the web env) |
| Toolchain | rustup stable, `rzup` (cargo-risczero / r0vm 3.0.6, rust 1.97, `risc0-groth16`) |
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
Groth16 proving of one statement (~34M cycles) on 4 CPU cores takes minutes; a GPU host (`--features cuda`) brings it to about a minute.

## Security notes
- `POST /jobs` requires `x-prover-token`; the token is public in the web bundle, so it only deters drive-by abuse. Real auth (SEP-10 wallet login) is on the roadmap.
- At most `MAX_JOBS_QUEUED` (8) jobs in flight; body limit 6 MiB; e-mails are kept only in memory for the job.
- Rotate the token: edit the unit file, `systemctl daemon-reload && systemctl restart zkotc-prover`, update `NEXT_PUBLIC_PROVER_TOKEN` and redeploy the web app.
