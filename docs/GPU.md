# GPU proving runbook — rent a box, prove in 15 seconds

Everything needed to go from "no GPU" to a running zkOTC prover in **about 6 minutes of wall time** on a freshly
rented machine, without repeating the detours of the first attempt (which took an afternoon). Measured on an
RTX 4090: a real e-dekont proves in **15 s** through the API (STARK 4.8 s, witness 2–4 s, Groth16 2.3 s on the
GPU with the ICICLE-snark worker), versus 84 minutes on the 4-vCPU Azure VM.

Two moving parts:

| where | what | why |
|---|---|---|
| **artifact host** = our Azure VM (`kaleab@4.239.243.216`, `~/gpu-artifacts/`) | `bin/latest/` prebuilt `zkotc` + `zkotc-server`; `icicle/` the ICICLE-snark GPU Groth16 worker (12 MB, built once by `scripts/gpu/build-icicle.sh`); `zkey/` the risc0 `stark_verify` zkey + witness graph (3.9 GB); `g16/` the reference CPU prover files (2.5 GB, fallback engine) | a fresh box downloads ~4 GB in ~3 min instead of compiling for 30 |
| **GPU box** = any rented CUDA container/VM, Ubuntu 24.04 | `scripts/gpu/bootstrap.sh` verifies checksums and starts `zkotc-server` | ephemeral; nothing on it needs saving |

`scripts/gpu/deploy.sh` (run on your Mac) ties them together. One-time: copy `scripts/gpu/.env.example` to
`scripts/gpu/.env` and fill in `PROVER_TOKEN` (same value as `NEXT_PUBLIC_PROVER_TOKEN` in `web/.env.local`).

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
   testnet escrow (all other fields unchanged) and writes `NEXT_PUBLIC_PROVER_URL` into `web/.env.local`
   (restart `npm run dev`). Without `--switch` it only tells you they differ,
7. `--test`: uploads the e-dekont through the API and prints the phase timings and the seal size.

Expected output at the end:

```
prover: http://98.191.113.12:11267
info:   {"image_id":"0x3e55…","prover_mode":"groth16","dkim_source":"dns","public_values_len":152}
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

- Web app: `NEXT_PUBLIC_PROVER_URL=http://<ip>:<port>` (`--switch` writes it). Plain HTTP is fine from
  `http://localhost:3000`; from an HTTPS site you would need a TLS front (`cloudflared` is preinstalled on Vast
  boxes: `cloudflared tunnel --url http://localhost:10100` gives a temporary HTTPS URL).
- CLI on the box: `GROTH16_ICICLE_DIR=~/gpu-artifacts/icicle GROTH16_ZKEY_DIR=~/gpu-artifacts/zkey ~/zkotc/bin/zkotc prove --eml x.eml --iban TR… --name "AD SOYAD" --offer-id N --dns --out proof.json`
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
only ever existed in the server's memory for the duration of a job.

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
