#!/usr/bin/env bash
# zkOTC GPU prover — box-side bootstrap. Runs as root ON the rented GPU box (Ubuntu 24.04 + NVIDIA driver).
# Normally invoked by scripts/gpu/deploy.sh; can be run by hand:
#
#   bash ~/zkotc/bootstrap.sh            # prebuilt binaries from ~/gpu-artifacts/bin/latest, then serve
#   bash ~/zkotc/bootstrap.sh --build    # build ~/zkotc/{zkotc-lib,prover} from source (nvcc, ~30 min), then serve
#   bash ~/zkotc/bootstrap.sh --no-serve # skip starting the server
#
# Inputs (put in place by deploy.sh):
#   ~/gpu-artifacts/g16/         reference Groth16 prover files (stark_verify, prover, .cs, .dat, .pk.dmp + SHA256SUMS)
#   ~/gpu-artifacts/bin/latest/  prebuilt zkotc + zkotc-server (+ SHA256SUMS, BUILD.txt)
#   ~/zkotc/gpu.env              PORT, PROVER_TOKEN, CORS_ORIGIN, DKIM_DNS, MAX_JOBS_QUEUED
# Outputs: ~/zkotc/bin/{zkotc,zkotc-server}, ~/zkotc/server.log, ~/zkotc/bootstrap.log, ~/zkotc/bootstrap.status (OK|FAIL)
#
# Lessons baked in (see docs/GPU.md): never use the CUDA Groth16 wrap of risc0 3.0.x (it crashes: GROTH16_NATIVE_DIR
# is always set); the rzup `r0vm` is CPU-only and the 5 GB `risc0-groth16` rzup component is not needed; `protoc` and
# `libgmp10` are missing from the Vast CUDA image; log to files and poll instead of holding long ssh pipes.
set -euo pipefail

A=$HOME/gpu-artifacts
Z=$HOME/zkotc
LOG=$Z/bootstrap.log
BUILD=0; SERVE=1
for arg in "$@"; do
  case "$arg" in
    --build) BUILD=1 ;;
    --no-serve) SERVE=0 ;;
    *) echo "unknown flag $arg" >&2; exit 2 ;;
  esac
done
mkdir -p "$Z/bin" "$Z/cache"
exec > >(tee -a "$LOG") 2>&1
echo "RUNNING" > "$Z/bootstrap.status"
trap 'echo "bootstrap FAILED at line $LINENO (see $LOG)"; echo FAIL > "$Z/bootstrap.status"' ERR
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

step "Groth16 reference prover files"
[ -f "$A/g16/SHA256SUMS" ] || { echo "missing $A/g16 (deploy.sh syncs it from the artifact host)"; exit 1; }
(cd "$A/g16" && sha256sum -c --quiet SHA256SUMS) && echo "g16 checksums OK"
if [ -d "$HOME/g16" ] && [ ! -L "$HOME/g16" ]; then mv "$HOME/g16" "$HOME/g16.manual"; fi
ln -sfn "$A/g16" "$HOME/g16"

pkill -x zkotc-server 2>/dev/null && sleep 1 || true   # a running server holds the binary ("Text file busy")
install_bin() { for b in zkotc zkotc-server; do install -m 755 "$1/$b" "$Z/bin/$b.new" && mv -f "$Z/bin/$b.new" "$Z/bin/$b"; done; }

if [ "$BUILD" = 1 ]; then
  step "toolchain (rustup + rzup rust toolchain; no r0vm, no risc0-groth16 component needed)"
  command -v nvcc >/dev/null || export PATH=/usr/local/cuda/bin:$PATH
  command -v nvcc >/dev/null || { echo "nvcc not found — rent the 'NVIDIA CUDA' (devel) image"; exit 1; }
  [ -x "$HOME/.cargo/bin/cargo" ] || curl -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal >/dev/null
  export PATH=$HOME/.cargo/bin:$HOME/.risc0/bin:$PATH
  [ -x "$HOME/.risc0/bin/rzup" ] || curl -sL https://risczero.com/install | bash >/dev/null 2>&1
  rustup toolchain list | grep -q '^risc0' || rzup install rust
  step "cargo build --release --features cuda (nvcc kernels for this GPU + PTX; ~30 min on 32 vCPU)"
  CC=$(nvidia-smi --query-gpu=compute_cap --format=csv,noheader | head -1 | tr -d '.')
  export NVCC_APPEND_FLAGS="${NVCC_APPEND_FLAGS:--gencode arch=compute_${CC},code=[sm_${CC},compute_${CC}]}"
  echo "NVCC_APPEND_FLAGS=$NVCC_APPEND_FLAGS"
  ( cd "$Z/prover" && cargo build --release --features cuda 2>&1 | grep -E "Compiling risc0|Compiling zkotc|Finished|^error|warning: unused" )
  install_bin "$Z/prover/target/release"
  echo "built $(git -C "$Z" rev-parse --short HEAD 2>/dev/null || echo '?')"
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
  export PORT=${PORT:-10100} GROTH16_NATIVE_DIR=$HOME/g16 SUCCINCT_CACHE_DIR=$Z/cache RUST_LOG=${RUST_LOG:-info}
  nohup "$Z/bin/zkotc-server" > "$Z/server.log" 2>&1 &
  for _ in $(seq 1 30); do curl -sf "localhost:$PORT/info" >/dev/null 2>&1 && break; sleep 1; done
  curl -sf "localhost:$PORT/info" || { echo "server did not come up:"; tail -20 "$Z/server.log"; exit 1; }
  echo
  pub="VAST_TCP_PORT_$PORT"
  if [ -n "${PUBLIC_IPADDR:-}" ] && [ -n "${!pub:-}" ]; then
    echo "PUBLIC_URL=http://$PUBLIC_IPADDR:${!pub}"
  else
    echo "PUBLIC_URL=? (no Vast port mapping for $PORT; use ssh -L $PORT:localhost:$PORT)"
  fi
fi

echo "OK" > "$Z/bootstrap.status"
echo; echo "bootstrap OK in $(( $(date +%s) - T0 ))s"
