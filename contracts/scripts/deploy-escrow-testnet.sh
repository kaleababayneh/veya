#!/usr/bin/env bash
# Deploy the OTC escrow to Stellar testnet.
#   ./scripts/deploy-escrow-testnet.sh <image_id_hex> [identity] [alias]
# Verifier = RISC Zero verifier router from risc0-verifier-deployment.toml (NethermindEth/stellar-risc0-verifier).
set -euo pipefail
cd "$(dirname "$0")/.."
IMAGE_ID="${1:?guest image id hex (from: zkotc image-id)}"; IMAGE_ID="${IMAGE_ID#0x}"
IDENTITY="${2:-stellarpro}"
ALIAS="${3:-otc-escrow}"
STELLAR="${STELLAR_BIN:-stellar}"
NETWORK=testnet
VERIFIER_ID=$(python3 -c "import tomllib; print(tomllib.load(open('risc0-verifier-deployment.toml','rb'))['chains']['stellar-testnet']['router'])")
ADMIN=$($STELLAR keys address "$IDENTITY")
DOMAIN_HASH=$(printf 'ileti.ziraatbank.com.tr' | shasum -a 256 | cut -d' ' -f1)
DKIM_KEY_HASH=$(shasum -a 256 ../zkotc-lib/testdata/ziraat-ileti-msg2.der | cut -d' ' -f1)
XLM_SAC=$($STELLAR contract id asset --asset native --network $NETWORK)
USDC_SAC=$($STELLAR contract id asset --asset USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5 --network $NETWORK)
echo ">> admin=$ADMIN verifier=$VERIFIER_ID"
echo ">> image_id=$IMAGE_ID"
echo ">> domain_hash=$DOMAIN_HASH dkim_key_hash=$DKIM_KEY_HASH"
echo ">> tokens: XLM=$XLM_SAC USDC=$USDC_SAC"
( cd escrow && $STELLAR contract build >/dev/null )
WASM=target/wasm32v1-none/release/zkotc_escrow.wasm
CONTRACT_ID=$($STELLAR contract deploy \
  --wasm "$WASM" --source "$IDENTITY" --network $NETWORK --alias "$ALIAS" \
  -- \
  --admin "$ADMIN" \
  --verifier "$VERIFIER_ID" \
  --image_id "$IMAGE_ID" \
  --domain_hash "$DOMAIN_HASH" \
  --dkim_key_hashes "[\"$DKIM_KEY_HASH\"]" \
  --tokens "[\"$XLM_SAC\",\"$USDC_SAC\"]" \
  --lock_duration 3600 \
  --fee_bps 25 \
  --fee_recipient "$ADMIN" \
  --min_try_kurus 5000 \
  --max_try_kurus 500000)
echo ">> deployed: $CONTRACT_ID"
echo "$CONTRACT_ID" > ".$ALIAS.testnet.id"
echo ">> https://stellar.expert/explorer/testnet/contract/$CONTRACT_ID"
