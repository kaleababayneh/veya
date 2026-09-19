#!/usr/bin/env bash
# Build the ICICLE-snark GPU Groth16 worker ON a CUDA box (once; ~10 min) and stage it as an artifact:
#   bash scripts/gpu/build-icicle.sh          # → ~/gpu-artifacts/icicle/{icicle-snark, libicicle_*.so, backend/cuda/*.so, SHA256SUMS}
#                                              # → ~/gpu-artifacts/zkey/{stark_verify_final.zkey, stark_verify_graph.bin}
# then `scripts/gpu/deploy.sh "<ssh>" --publish` from your machine copies it to the artifact host.
# ICICLE-snark (MIT) proves the risc0 stark_verify circuit from its snarkjs zkey in ~2.4 s on an RTX 4090
# (warm), replacing the 11–12 s reference CPU prover. Its CUDA backend is built for PTX sm_52 (JIT on any GPU).
set -euo pipefail
export PATH=$HOME/.cargo/bin:/usr/local/cuda/bin:$PATH
command -v nvcc >/dev/null || { echo "nvcc not found (use the NVIDIA CUDA devel image)"; exit 1; }
command -v cmake >/dev/null || apt-get -qq install -y cmake >/dev/null
[ -x "$HOME/.cargo/bin/cargo" ] || curl -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal >/dev/null
A=$HOME/gpu-artifacts
REV=${ICICLE_SNARK_REV:-bf00385}   # ingonyama-zk/icicle-snark commit this was tested with
cd "$HOME"
if [ ! -d icicle-snark ]; then
  git clone -q --recursive https://github.com/ingonyama-zk/icicle-snark && (cd icicle-snark && git checkout -q "$REV")
fi
cd icicle-snark/icicle
[ -f build/backend/cuda/libicicle_backend_cuda_curve_bn254.so ] || {
  cmake -DCMAKE_BUILD_TYPE=Release -DCURVE=bn254 -DCUDA_BACKEND=local -S . -B build >/dev/null
  cmake --build build -j "$(nproc)" 2>&1 | grep -E "error|Built target icicle_cuda" || true
}
cd .. && cargo build --release 2>&1 | grep -E "Finished|^error"
mkdir -p "$A/icicle/backend/cuda" "$A/zkey"
cp target/release/icicle-snark icicle/build/libicicle_*.so "$A/icicle/"
cp icicle/build/backend/cuda/libicicle_backend_cuda_*.so "$A/icicle/backend/cuda/"
(cd "$A/icicle" && sha256sum icicle-snark libicicle_*.so backend/cuda/*.so > SHA256SUMS)
# the zkey + witness graph come from the rzup component (5 GB download) if not already staged
if [ ! -f "$A/zkey/stark_verify_final.zkey" ]; then
  export PATH=$HOME/.risc0/bin:$PATH
  [ -x "$HOME/.risc0/bin/rzup" ] || curl -sL https://risczero.com/install | bash >/dev/null 2>&1
  [ -d "$HOME/.risc0/extensions/v0.1.0-risc0-groth16" ] || rzup install risc0-groth16
  cp "$HOME/.risc0/extensions/v0.1.0-risc0-groth16/stark_verify_final.zkey" "$HOME/.risc0/extensions/v0.1.0-risc0-groth16/stark_verify_graph.bin" "$A/zkey/"
fi
ls -la "$A/icicle" "$A/zkey"
echo "icicle artifacts staged in $A — publish with: scripts/gpu/deploy.sh \"<ssh>\" --publish"
