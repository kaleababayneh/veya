#!/usr/bin/env bash
# Do the three copies of the guest image id agree? (repo pin, the escrow's config, the running prover)
#   scripts/check-image-id.sh            # uses ESCROW_ID / PROXY_URL from scripts/gpu/.env
# Exit 1 on any mismatch. `deploy.sh --switch` writes prover/IMAGE_ID; a guest change without a switch shows up here.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f scripts/gpu/.env ] && { set -a; . scripts/gpu/.env; set +a; }
PIN=$(tr -d '[:space:]' < prover/IMAGE_ID)
ESC=$(stellar contract invoke --id "${ESCROW_ID:?}" --network testnet --source "${STELLAR_IDENTITY:-stellarpro}" -- config 2>/dev/null | python3 -c 'import json,sys; print("0x"+json.load(sys.stdin)["image_id"])')
PROVER=$(curl -sf --max-time 15 "${PROXY_URL:-${NEXT_PUBLIC_PROVER_URL:-http://localhost:8787}}/info" | python3 -c 'import json,sys; print(json.load(sys.stdin)["image_id"])' 2>/dev/null || echo "unreachable")
printf 'repo pin: %s\nescrow:   %s\nprover:   %s\n' "$PIN" "$ESC" "$PROVER"
ok=1
[ "$PIN" = "$ESC" ] || { echo "MISMATCH: prover/IMAGE_ID ≠ escrow config (run deploy.sh --switch or update the pin)"; ok=0; }
[ "$PROVER" = "$ESC" ] || { echo "MISMATCH: running prover ≠ escrow config (proofs will be rejected on-chain)"; ok=0; }
[ $ok = 1 ] && echo "OK: all three agree"
[ $ok = 1 ]
