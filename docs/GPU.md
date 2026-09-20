# GPU proving runbook — rent a box, prove in 15 seconds

Everything needed to go from "no GPU" to a running zkOTC prover in **about 6 minutes of wall time** on a freshly
rented machine, without repeating the detours of the first attempt (which took an afternoon). Measured on an
RTX 4090: a real e-dekont proves in **15 s** through the API (STARK 4.8 s, witness 2–4 s, Groth16 2.3 s on the
GPU with the ICICLE-snark worker), versus 84 minutes on the 4-vCPU Azure VM.

**2026-09-19: the Azure VM that used to be the artifact host and the HTTPS proxy is gone.** The artifact store now
lives on the machine you deploy from, and HTTPS comes from a tunnel on the box itself. Nothing else is needed.

**Later the same day: a Hetzner server took over as artifact host** (`ARTIFACT_HOST=validator@138.201.80.51`,
`ARTIFACT_SSH_OPTS="-i ~/.ssh/hetzner-kaleab"`, store in `~/gpu-artifacts` there: binaries, ICICLE worker *and* the 3.9 GB
zkey). It pushes to a new box datacenter-to-datacenter, so a rental needs neither the laptop upload nor the 5 GB rzup
download. The copy in `~/gpu-artifacts` on the Mac stays as a backup (`ARTIFACT_HOST=local`). That server is a live
validator and `validator` has no passwordless sudo: it is a file store only. HTTPS still comes from the tunnel on the
box; a fixed `https://138-201-80-51.sslip.io/gpu` proxy would need Caddy installed and ports 80/443 opened there by its owner.

Three moving parts:

| where | what | why |
|---|---|---|
| **artifact store** = this machine, `~/gpu-artifacts/` (`ARTIFACT_HOST=local`) | `bin/<git>-<img8>/` + `bin/latest` prebuilt `zkotc` + `zkotc-server`; `icicle/` the ICICLE-snark GPU Groth16 worker (built once by `scripts/gpu/build-icicle.sh`). About 100 MB. | The binaries are the one thing that cannot be recreated: every build has its own image id and the escrow accepts exactly one. **Back this folder up.** The 3.9 GB zkey is *not* stored: it is public, and the box downloads it from RISC Zero itself (`rzup install risc0-groth16`), faster than a laptop could upload it. |
| **GPU box** = any rented CUDA container/VM, Ubuntu 24.04 | `scripts/gpu/bootstrap.sh` verifies checksums, fetches the zkey, starts `zkotc-server` and a Cloudflare quick tunnel | ephemeral; nothing on it needs saving |
| **web app** | the browser only calls the app's own `/api/prove`, `/api/prove/info`, `/api/prove/jobs/<id>`; the server side forwards to `PROVER_URL` | the box's address changes with every rental and never reaches the browser; no CORS, no mixed content |

`scripts/gpu/deploy.sh` (run on your Mac) ties them together. One-time: copy `scripts/gpu/.env.example` to
`scripts/gpu/.env` and fill in `PROVER_TOKEN` (same value as `PROVER_TOKEN` in `web/.env.local` and on Vercel).

## 0. The whole thing, next time

```sh
# 1. rent a 4090 on Vast (§1), copy its "Direct SSH" line, then from the repo root:
scripts/gpu/deploy.sh "ssh -p <port> root@<ip> -L 8080:localhost:8080" --test zkotc-lib/testdata/private/<some>.eml
# 2. local app: nothing to do, PROVER_URL in web/.env.local now points at the box's https tunnel.
# 3. live site: the same command with --vercel sets PROVER_URL on Vercel and redeploys (the tunnel URL is new
#    with every rental, and Vercel only reads env changes on a new deployment).
```
~5 min: binaries up from this machine, zkey down from RISC Zero (the slow part, ~3 min), checksums, server, tunnel.
No `--switch` is needed as long as `~/gpu-artifacts/bin/latest` is the build the escrow is configured for
(`BUILD.txt` there names the image id; `deploy.sh` checks it against the escrow and says so).

If `~/gpu-artifacts` is ever lost: `--build --publish --switch` on any box (~30 min) makes a new build, saves it here
and re-points the escrow at its image id.

The quick tunnel (`https://<random>.trycloudflare.com`) lives as long as the `cloudflared` process on the box. If the
container restarts, `bootstrap.sh` starts a new tunnel with a **new URL** (`grep TUNNEL_URL ~/zkotc/bootstrap.log`):
run `deploy.sh … --vercel` again. A stable hostname needs a named Cloudflare tunnel on a domain whose DNS is on
Cloudflare; not set up.

## 1. Rent (Vast.ai, ~2 min)

1. Add credit first (the site will not create an instance at $0.00) and put your SSH public key on the **Keys**
   page once (`cat ~/.ssh/id_ed25519.pub`) so every instance gets it. Per-instance keys also work.
2. Template: **NVIDIA CUDA** (`vastai/base-image`, CUDA 12.8 *devel*, Ubuntu 24.04), launch mode **SSH**.
3. Filters: **1× RTX 4090** (any Ada/Hopper/Blackwell card with ≥ 16 GB VRAM works with the prebuilt binaries:
   4070 Ti/4080/4090, L4, L40S, H100, RTX 50xx; older cards such as 3090 or A100 need a `--build`), **≥ 16 vCPU**
   (the Groth16 wrap runs on the CPU: 32 threads → 12 s), **≥ 32 GB RAM** (the wrap peaks at 8.6 GB), reliability
   **≥ 98 %**, **on-demand** (not interruptible), disk **32 GB** for prebuilt, **64 GB** if you will build.
   Best value seen so far: $0.36/h for a 4090 with 32 vCPU. Do not pay for an H100: it saves ~15 s per proof.
4. Rent. The card turns green ("Running") within 1–3 minutes. If it sits in "Loading" for more than 5 minutes with
   `failed to resolve reference "docker.io/vastai/base-image…"` in its status, the host cannot reach Docker Hub:
   **destroy it and rent another** (it will never recover).
5. Open **Instances → the card → ">_ Connect"** and copy the **Direct SSH** line, e.g.
   `ssh -p 11953 root@98.191.113.12 -L 8080:localhost:8080`.

## 2. Deploy (~4 min)

```sh
scripts/gpu/deploy.sh "ssh -p 11953 root@98.191.113.12 -L 8080:localhost:8080" --switch --test path/to/e-dekont.eml
```

What it does, in order (each step prints its elapsed time):

1. waits for SSH ("Permission denied" during the first seconds after boot is normal — Vast injects the key late),
2. authorizes the artifact host's key on the box (on its **own line**: the file ships without a trailing newline,
   appending blindly corrupts your key),
3. `rsync` of `~/gpu-artifacts` from the artifact host straight to the box (2.8 GB, ~2 min at 25 MB/s),
4. runs `bootstrap.sh` on the box under `nohup`, polling a status file (never hold a long ssh pipe: it hangs),
   which checks the SHA-256 of every file, installs `libgmp10`, and starts `zkotc-server` with the Groth16 engine
   from `ENGINE=` in your `.env` (`icicle`: `GROTH16_ICICLE_DIR` + `GROTH16_ZKEY_DIR`; `native`: `GROTH16_NATIVE_DIR`),
   `SUCCINCT_CACHE_DIR=~/zkotc/cache` and your token / CORS settings,
5. prints the public URL: Vast maps container port `10100` to a public port (`VAST_TCP_PORT_10100`; ports 8080,
   8384, 6006 and 1111 belong to Vast's own portal, do not use them), and `GET /info` with the box's `image_id`,
6. `--switch`: compares that image id with the escrow's `config.image_id`; if different, runs `set_config` on the
   testnet escrow (all other fields unchanged). Without `--switch` it only tells you they differ,
7. re-points the HTTPS proxy: the web app (and Vercel) call `PROXY_URL` (`https://4-239-243-216.sslip.io/gpu`,
   Caddy on the artifact host, `handle_path /gpu/*`), whose target is the box's public `ip:port`. `deploy.sh`
   rewrites that line over ssh (`sudo sed` + `systemctl reload caddy`), then checks `PROXY_URL/info` returns the
   box's image id, and writes `NEXT_PUBLIC_PROVER_URL=PROXY_URL` into `web/.env.local` if it is not already there
   (`--no-proxy` skips this),
8. `--test`: uploads the e-dekont through the API and prints the phase timings and the seal size.

Expected output at the end:

```
prover: http://98.191.113.12:11267
info:   {"image_id":"0x89f97cff…","prover_mode":"groth16","dkim_source":"dns","public_values_len":184}
escrow CAFU5GMK… already accepts this box's image id
proxy ok: https://4-239-243-216.sslip.io/gpu/info answers with the box's image id
job 8296cd79-…: queued
   2.1s proving
  15.0s done
OK in 15.0s — seal 260 B, cycles 2621440, amount 168150 kuruş on 20260905
```

**Why the image id matters.** The guest image id is *not* reproducible across machines (RISC Zero only guarantees
that with `RISC0_USE_DOCKER=1`). Every build has its own id, the escrow only accepts proofs for the id in its
config, so a box with a fresh build needs `--switch`. Prebuilt binaries keep the same id across rentals, so after
the first `--switch` further rentals of the same build need nothing. The Azure prover keeps its own (different) id;
whichever prover the app uses must be the one the escrow points at.

## 3. Use it

- Web app: `NEXT_PUBLIC_PROVER_URL=https://4-239-243-216.sslip.io/gpu` (`PROXY_URL`; `deploy.sh` writes it) both
  locally and on Vercel. The box's plain `http://<ip>:<port>` also works from `http://localhost:3000` (a browser
  on an HTTPS page cannot call it). Without an artifact host: `cloudflared tunnel --url http://localhost:10100`
  on the box gives a temporary HTTPS URL.
- CLI on the box: `GROTH16_ICICLE_DIR=~/gpu-artifacts/icicle GROTH16_ZKEY_DIR=~/gpu-artifacts/zkey ~/zkotc/bin/zkotc prove --eml x.eml --iban TR… --name "AD SOYAD" --offer-id N --buyer G… --dns --out proof.json`
  (`--buyer` is the claiming wallet; the dekont's description must carry `zkotc reference --offer-id N --buyer G…`)
  (the CLI starts its own ICICLE worker, so add ~2 s; the server keeps one warm)
- Logs: `~/zkotc/server.log` (no e-mail bodies), `~/zkotc/bootstrap.log`. Restart the server (also after the
  container rebooted, which kills the `nohup` server): `bash ~/zkotc/bootstrap.sh` keeps the installed binaries;
  `--reinstall` replaces them from the synced artifacts; `--build` rebuilds from `~/zkotc` sources.

## 4. When the prover code changes

```sh
scripts/gpu/deploy.sh "<ssh line>" --build --publish --switch
```
`--build` syncs your working tree, installs rustup + the RISC Zero Rust toolchain (nothing else from `rzup` is
needed) and compiles with `--features cuda` (~30 min on 32 vCPU: `nvcc` compiles the rv32im and recursion kernels
for the box's GPU plus PTX for newer ones). `--publish` copies the two binaries to the artifact host under
`bin/<git>-<imageid8>/` and moves `bin/latest` there, so the next rental is back to 4 minutes. Build on the oldest
GPU architecture you intend to rent (kernels built on a 4090 = `sm_89` run on Ada and newer only).

### Groth16 engines
| engine | how | wrap time | needs |
|---|---|---|---|
| `icicle` (default) | ICICLE-snark worker process on the GPU, witness in-process | ~5 s (2.3 s proof warm, 4 s cold) | `icicle/` + `zkey/` artifacts, ≥ 10 GB VRAM free |
| `native` | reference CPU prover from the risc0 Docker image, run natively | ~19 s (witness 7 s, prover 12 s on 32 threads) | `g16/` artifacts, ≥ 16 vCPU |
| risc0's CUDA wrap | — | crashes on 3.0.x ([#3785](https://github.com/risc0/risc0/issues/3785)) | never enable |

The ICICLE worker is rebuilt only when its source changes: `bash scripts/gpu/build-icicle.sh` on a CUDA box (≈10 min),
then `deploy.sh "<ssh>" --publish`. The upstream CLI busy-loops if its stdin closes; `zkotc-server` sends it `exit`
and it is bound to the server with `PR_SET_PDEATHSIG`, so a server crash cannot leave a worker spinning on the GPU.

## 5. Tear down

Destroy the instance on Vast when done (a stopped instance still bills storage). Nothing on the box needs saving:
the artifacts live on the artifact host, receipts in `~/zkotc/cache` are reproducible, and the uploaded e-mails
only ever existed in the server's memory for the duration of a job. If you built on the box, `--publish` first
(check: `sha256sum ~/zkotc/bin/zkotc-server` on the box = `bin/latest/SHA256SUMS` on the artifact host).
Until the next rental the live site's prover calls fail (the proxy points at a dead host); the market, reserving,
revealing and declaring keep working since they do not touch the prover.

Cost: 4090 at $0.36/h ≈ $0.003 per proof; the afternoon that produced this runbook cost about $1.

## 6. The mistakes this runbook avoids

| what happened | what to do instead |
|---|---|
| `cargo build --features cuda` failed after 8 min: `Could not find protoc` | `bootstrap.sh --build` installs `protobuf-compiler` (and `clang`, `libssl-dev`, `libgmp10`) up front |
| Groth16 wrap crashed on the GPU: `sppark_error … an illegal memory access` after the STARK succeeded | Known risc0 3.0.x bug ([#3785](https://github.com/risc0/risc0/issues/3785), fixed only in the unreleased 5.0.0-rc.1 whose verifier params the Stellar router lacks). `zkotc-host` wraps with the *reference CPU prover* run natively (`GROTH16_NATIVE_DIR`): 19 s. Never enable the CUDA wrap on 3.0.x. |
| Docker not available inside the Vast container, so risc0's usual Docker wrap cannot run | The native engine needs no Docker: the five files in `g16/` are the image's contents |
| Downloaded the 5 GB `rzup install risc0-groth16` component and `r0vm` for nothing | With the native engine neither is needed; `r0vm` from rzup is CPU-only anyway |
| Waited 28 min for the compile on every box | Prebuilt binaries on the artifact host (`--build --publish` once per code change) |
| Appended a key to `~/.ssh/authorized_keys` and got `Permission denied` for it | The file has no trailing newline; `deploy.sh` writes `\n<key>\n` and de-blanks |
| Proof finished but the ssh session hung 10 min, hiding the timings | Long jobs run under `nohup` with logs; the scripts poll files instead of holding pipes |
| First proof after a start 13 s, every later one 60–120 s, GPU idle between short bursts (2026-09-19: 2 × EPYC 9554 host, 256 CPUs visible, container quota ~31) | The prover starts one thread per visible CPU; on a big shared two-socket host they starve the thread that feeds the GPU. `bootstrap.sh` now runs the server with `PROVER_THREADS` (default 16) pinned with `taskset` to cores on the GPU's own NUMA node: a steady 11 s. Not the cause, checked: PCIe link (Gen4 x16 under load), cgroup throttling (none), GPU clocks, memory. |
| Restart failed with `Address already in use` | The old server needs several seconds to tear down its CUDA context; `bootstrap.sh` now waits for it to exit before starting the new one |
| `--publish` to a Mac died with an rsync usage error | The rsync shipped with macOS (openrsync 2.6.9) refuses `--partial` together with `--inplace` or with two remote sources; `deploy.sh` pulls one file per call and retries |
| Instance stuck in "Loading" for 14 min (host DNS broken) | Destroy after 5 min and rent another host; check the status text on the card |
| `zsh: == not found` in an ad-hoc command | `=cmd` is a zsh expansion; quote it or use bash |
| Set `NVCC_APPEND_FLAGS` for a rebuild and cargo recompiled every CUDA kernel (25 min) | Never change nvcc flags between builds; `bootstrap.sh --build` unsets them |
| `pkill -f <name>` killed the SSH session that was running it | `pkill -x`, or match on something not in your own command line |
| ICICLE-snark kept spinning at 100% CPU after its stdin closed | It only stops on an `exit` command; the server does that and uses PDEATHSIG |
| Escrow rejected the box's proofs: wrong image id | `deploy.sh --switch` (or `set_config --image_id`), see §2 |

## 7. Other providers

Anything that gives root on an Ubuntu 24.04 machine with an NVIDIA driver works the same way (RunPod, Lambda, a
cloud VM): `deploy.sh "<ssh line>"`. Without Vast's port mapping the script falls back to `http://localhost:10100`
through `ssh -L 10100:localhost:10100`. Ubuntu 22.04 images (glibc 2.35) cannot run the prebuilt binaries; use
`--build` there. Google Colab is not usable (no SSH, sessions die, and only a T4 is free, which is 5–10× slower).
