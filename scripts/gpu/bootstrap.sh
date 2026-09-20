#!/usr/bin/env bash
# zkOTC GPU prover — box-side bootstrap. Runs as root ON the rented GPU box (Ubuntu 24.04 + NVIDIA driver).
# Normally invoked by scripts/gpu/deploy.sh; can be run by hand:
#
#   bash ~/zkotc/bootstrap.sh            # prebuilt binaries from ~/gpu-artifacts/bin/latest, then serve
#   bash ~/zkotc/bootstrap.sh --build    # build ~/zkotc/{zkotc-lib,prover} from source (nvcc, ~30 min), then serve
#   bash ~/zkotc/bootstrap.sh --no-serve # skip starting the server
#   bash ~/zkotc/bootstrap.sh --reinstall # replace installed binaries with ~/gpu-artifacts/bin/latest (deploy.sh does this)
# Without --build/--reinstall an already installed ~/zkotc/bin is kept (a box that built newer code than the
# synced artifacts must not be downgraded by a restart after a reboot).
#
# Inputs (put in place by deploy.sh):
#   ~/gpu-artifacts/icicle/      ICICLE-snark GPU Groth16 worker + libs (ENGINE=icicle, default)
#   ~/gpu-artifacts/zkey/        stark_verify_final.zkey + stark_verify_graph.bin (risc0 groth16 component; fetched here with rzup when not staged)
#   ~/gpu-artifacts/g16/         reference CPU Groth16 prover files (ENGINE=native fallback)
#   ~/gpu-artifacts/bin/latest/  prebuilt zkotc + zkotc-server (+ SHA256SUMS, BUILD.txt)
#   ~/zkotc/gpu.env              ENGINE, PORT, PROVER_TOKEN, CORS_ORIGIN, DKIM_DNS, MAX_JOBS_QUEUED, TUNNEL, PROVER_THREADS
# Outputs: ~/zkotc/bin/{zkotc,zkotc-server}, ~/zkotc/server.log, ~/zkotc/bootstrap.log, ~/zkotc/bootstrap.status (OK|FAIL)
#
# Lessons baked in (see docs/GPU.md): never use the CUDA Groth16 wrap of risc0 3.0.x (it crashes: GROTH16_NATIVE_DIR
# is always set); the rzup `r0vm` is CPU-only and the 5 GB `risc0-groth16` rzup component is not needed; `protoc` and
# `libgmp10` are missing from the Vast CUDA image; log to files and poll instead of holding long ssh pipes.
set -euo pipefail

A=$HOME/gpu-artifacts
Z=$HOME/zkotc
LOG=$Z/bootstrap.log
BUILD=0; SERVE=1; REINSTALL=0
for arg in "$@"; do
  case "$arg" in
    --build) BUILD=1 ;;
    --no-serve) SERVE=0 ;;
    --reinstall) REINSTALL=1 ;;
    *) echo "unknown flag $arg" >&2; exit 2 ;;
  esac
done
mkdir -p "$Z/bin" "$Z/cache"
exec > >(tee -a "$LOG") 2>&1
echo "RUNNING" > "$Z/bootstrap.status"
trap 'echo "bootstrap FAILED at line $LINENO (see $LOG)"; echo FAIL > "$Z/bootstrap.status"' ERR
# an explicit `exit 1` (missing artifact) does not fire ERR: make sure the status never stays RUNNING
trap '[ "$(cat "$Z/bootstrap.status")" = OK ] || echo FAIL > "$Z/bootstrap.status"' EXIT
T0=$(date +%s)
step() { echo; echo "== [$(( $(date +%s) - T0 ))s] $*"; }

step "preflight"
nvidia-smi --query-gpu=name,memory.total,driver_version,compute_cap --format=csv,noheader
. /etc/os-release; echo "os: $PRETTY_NAME  cpus: $(nproc)  ram: $(free -g | awk '/Mem/{print $2}') GB  disk free: $(df -h "$HOME" | awk 'NR==2{print $4}')"
[ "${VERSION_ID:-}" = "24.04" ] || echo "WARNING: prebuilt binaries target Ubuntu 24.04 (glibc 2.39); this is $VERSION_ID — use --build if they fail to start"
export DEBIAN_FRONTEND=noninteractive
PKGS="libgmp10 time curl rsync"
[ "$BUILD" = 1 ] && PKGS="$PKGS build-essential pkg-config libssl-dev clang protobuf-compiler"
missing=""; for p in $PKGS; do dpkg -s "$p" >/dev/null 2>&1 || missing="$missing $p"; done
if [ -n "$missing" ]; then apt-get -qq update >/dev/null; apt-get -qq install -y $missing >/dev/null; echo "installed:$missing"; fi

ENGINE=$(grep -s '^ENGINE=' "$Z/gpu.env" | cut -d= -f2); ENGINE=${ENGINE:-icicle}
if [ "$ENGINE" = icicle ]; then
  step "Groth16 engine: icicle (GPU) — ICICLE-snark worker + risc0 zkey/graph"
  [ -f "$A/icicle/SHA256SUMS" ] || { echo "missing $A/icicle (build it once with scripts/gpu/build-icicle.sh, then --publish)"; exit 1; }
  (cd "$A/icicle" && sha256sum -c --quiet SHA256SUMS) && echo "icicle checksums OK"
  # the zkey + witness graph are public (risc0's groth16 component, 5 GB): a box with a datacenter link fetches them
  # itself in a few minutes, which beats uploading 3.9 GB from a laptop; an artifact host may still pre-stage them
  if [ ! -f "$A/zkey/stark_verify_final.zkey" ] || [ ! -f "$A/zkey/stark_verify_graph.bin" ]; then
    echo "zkey not staged — downloading risc0-groth16 with rzup (5 GB)"
    export PATH=$HOME/.cargo/bin:$HOME/.risc0/bin:$PATH
    # the rzup installer refuses to run without rustc ("Missing required tools: rustc"), and says so only on stderr
    [ -x "$HOME/.cargo/bin/rustc" ] || curl -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal >/dev/null
    [ -x "$HOME/.risc0/bin/rzup" ] || curl -sL https://risczero.com/install | bash >/dev/null
    EXT=$HOME/.risc0/extensions/v0.1.0-risc0-groth16
    [ -f "$EXT/stark_verify_final.zkey" ] || rzup install risc0-groth16 >/dev/null 2>&1
    mkdir -p "$A/zkey" && cp "$EXT/stark_verify_final.zkey" "$EXT/stark_verify_graph.bin" "$A/zkey/"
  fi
  for f in stark_verify_final.zkey stark_verify_graph.bin; do [ -f "$A/zkey/$f" ] || { echo "missing $A/zkey/$f"; exit 1; }; done
  chmod +x "$A/icicle/icicle-snark"
  pkill -x icicle-snark 2>/dev/null || true
else
  step "Groth16 engine: native (CPU) — reference prover files"
  [ -f "$A/g16/SHA256SUMS" ] || { echo "missing $A/g16 (deploy.sh syncs it from the artifact host)"; exit 1; }
  (cd "$A/g16" && sha256sum -c --quiet SHA256SUMS) && echo "g16 checksums OK"
  if [ -d "$HOME/g16" ] && [ ! -L "$HOME/g16" ]; then mv "$HOME/g16" "$HOME/g16.manual"; fi
  ln -sfn "$A/g16" "$HOME/g16"
fi

# a running server holds the binary ("Text file busy") and the port; tearing down its CUDA context can take several
# seconds, and a new server started before that fails with "Address already in use"
if pkill -x zkotc-server 2>/dev/null; then
  for _ in $(seq 1 30); do pgrep -x zkotc-server >/dev/null || break; sleep 1; done
  pgrep -x zkotc-server >/dev/null && { pkill -9 -x zkotc-server || true; sleep 1; }
fi
pkill -x icicle-snark 2>/dev/null || true   # its parent is gone; the next server starts its own worker
install_bin() { for b in zkotc zkotc-server; do install -m 755 "$1/$b" "$Z/bin/$b.new" && mv -f "$Z/bin/$b.new" "$Z/bin/$b"; done; }

if [ "$BUILD" = 1 ]; then
  step "toolchain (rustup + rzup rust toolchain; no r0vm, no risc0-groth16 component needed)"
  command -v nvcc >/dev/null || export PATH=/usr/local/cuda/bin:$PATH
  command -v nvcc >/dev/null || { echo "nvcc not found — rent the 'NVIDIA CUDA' (devel) image"; exit 1; }
  [ -x "$HOME/.cargo/bin/cargo" ] || curl -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal >/dev/null
  export PATH=$HOME/.cargo/bin:$HOME/.risc0/bin:$PATH
  [ -x "$HOME/.risc0/bin/rzup" ] || curl -sL https://risczero.com/install | bash >/dev/null 2>&1
  rustup toolchain list | grep -q '^risc0' || rzup install rust
  step "cargo build --release --features cuda (first time ~30 min on 32 vCPU: nvcc kernels for this GPU + PTX; later builds incremental)"
  # risc0 compiles the kernels with -arch=native (SASS for this GPU + PTX). Do NOT set NVCC_APPEND_FLAGS
  # between builds: cargo tracks it and would recompile every kernel.
  unset NVCC_APPEND_FLAGS NVCC_PREPEND_FLAGS
  ( cd "$Z/prover" && cargo build --release --features cuda 2>&1 | grep -E "Compiling risc0|Compiling zkotc|Finished|^error|warning: unused" )
  install_bin "$Z/prover/target/release"
  echo "built $(git -C "$Z" rev-parse --short HEAD 2>/dev/null || echo '?')"
elif [ -x "$Z/bin/zkotc-server" ] && [ "$REINSTALL" = 0 ]; then
  step "keeping installed binaries in $Z/bin (pass --reinstall to replace them from the artifacts)"
else
  step "prebuilt binaries"
  [ -f "$A/bin/latest/SHA256SUMS" ] || { echo "missing $A/bin/latest (run deploy.sh --build --publish once)"; exit 1; }
  (cd "$A/bin/latest" && sha256sum -c --quiet SHA256SUMS) && echo "binary checksums OK"
  cat "$A/bin/latest/BUILD.txt" 2>/dev/null || true
  install_bin "$A/bin/latest"
fi
echo "image_id: $("$Z/bin/zkotc" image-id)"

if [ "$SERVE" = 1 ]; then
  step "start zkotc-server"
  [ -f "$Z/gpu.env" ] || { echo "missing $Z/gpu.env"; exit 1; }
  set -a; . "$Z/gpu.env"; set +a
  export PORT=${PORT:-10100} SUCCINCT_CACHE_DIR=$Z/cache RUST_LOG=${RUST_LOG:-info}
  if [ "$ENGINE" = icicle ]; then export GROTH16_ICICLE_DIR=$A/icicle GROTH16_ZKEY_DIR=$A/zkey; else export GROTH16_NATIVE_DIR=$HOME/g16; fi
  # Threads: the prover starts one per visible CPU. On a big shared host (seen: 2 × EPYC, 256 CPUs, container quota
  # ~31) that starved the GPU: 13 s for the first proof, then 60–120 s with the GPU idle between short bursts. A small
  # pool pinned to cores on the GPU's own NUMA node gives a steady 11 s. PROVER_THREADS in gpu.env overrides (default 16).
  THREADS=${PROVER_THREADS:-16}; [ "$THREADS" -gt "$(nproc)" ] && THREADS=$(nproc)
  bdf=$(nvidia-smi --query-gpu=pci.bus_id --format=csv,noheader 2>/dev/null | head -1 | tr 'A-Z' 'a-z' | sed 's/^0000//')
  node=$(cat "/sys/bus/pci/devices/$bdf/numa_node" 2>/dev/null || echo -1); [ "$node" -ge 0 ] 2>/dev/null || node=0
  cpus=$(python3 - "$node" "$THREADS" <<'PY' 2>/dev/null || true
import sys
node, n = sys.argv[1], int(sys.argv[2])
try: spec = open(f"/sys/devices/system/node/node{node}/cpulist").read().strip()
except OSError: spec = ""
out = []
for part in filter(None, spec.split(",")):
    a, _, b = part.partition("-")
    out += range(int(a), int(b or a) + 1)
print(",".join(map(str, out[:n])))
PY
)
  export RAYON_NUM_THREADS=$THREADS
  if [ -n "$cpus" ] && taskset -c "$cpus" true 2>/dev/null; then
    echo "prover threads: $THREADS, pinned to CPUs $cpus (NUMA node $node, the GPU's)"
    nohup taskset -c "$cpus" "$Z/bin/zkotc-server" > "$Z/server.log" 2>&1 &
  else
    echo "prover threads: $THREADS (no CPU pinning: NUMA layout not readable)"
    nohup "$Z/bin/zkotc-server" > "$Z/server.log" 2>&1 &
  fi
  for _ in $(seq 1 30); do curl -sf "localhost:$PORT/info" >/dev/null 2>&1 && break; sleep 1; done
  curl -sf "localhost:$PORT/info" || { echo "server did not come up:"; tail -20 "$Z/server.log"; exit 1; }
  echo
  pub="VAST_TCP_PORT_$PORT"
  if [ -n "${PUBLIC_IPADDR:-}" ] && [ -n "${!pub:-}" ]; then
    echo "PUBLIC_URL=http://$PUBLIC_IPADDR:${!pub}"
  else
    echo "PUBLIC_URL=? (no Vast port mapping for $PORT; use ssh -L $PORT:localhost:$PORT)"
  fi
  # HTTPS without a server of our own: a Cloudflare quick tunnel (random https://….trycloudflare.com → this port).
  # The URL lives as long as this cloudflared process; a restart gives a new one (deploy.sh reads it from this log).
  if [ "${TUNNEL:-0}" = 1 ]; then
    step "https tunnel (cloudflared quick tunnel)"
    command -v cloudflared >/dev/null || { curl -sL -o /usr/local/bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 && chmod +x /usr/local/bin/cloudflared; }
    # a tunnel that is already up keeps its URL: it points at the port, not at the server process, so a re-deploy
    # (which restarts the server) must not hand the web app a new address
    turl=$(grep -saoE 'https://[a-z0-9-]+\.trycloudflare\.com' "$Z/tunnel.log" | head -1 || true)   # -a: the log can hold control bytes
    if pgrep -x cloudflared >/dev/null && [ -n "$turl" ] && curl -sf --max-time 15 "$turl/info" >/dev/null; then
      echo "keeping the running tunnel"
    else
      pkill -x cloudflared 2>/dev/null || true
      : > "$Z/tunnel.log"
      nohup cloudflared tunnel --no-autoupdate --url "http://localhost:$PORT" > "$Z/tunnel.log" 2>&1 &
      turl=""
    fi
    for _ in $(seq 1 40); do [ -n "$turl" ] && break; turl=$(grep -aoE 'https://[a-z0-9-]+\.trycloudflare\.com' "$Z/tunnel.log" | head -1 || true); [ -n "$turl" ] && break; sleep 1; done
    if [ -n "$turl" ]; then echo "TUNNEL_URL=$turl"; else echo "TUNNEL_URL=? (cloudflared gave no URL in 40 s; see $Z/tunnel.log)"; fi
  fi
fi

echo "OK" > "$Z/bootstrap.status"
echo; echo "bootstrap OK in $(( $(date +%s) - T0 ))s"
