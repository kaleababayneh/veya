# zkOTC — P2P TRY ⇄ XLM/USDC on Stellar with zero-knowledge proof of bank payment

Sellers escrow XLM or USDC in a Soroban contract. Buyers pay TRY with a normal **FAST** bank transfer, ask
**Ziraat Bankası** to e-mail the transfer's e-dekont, and prove — in zero knowledge — that the bank's DKIM-signed e-mail
contains that payment. The proof (a RISC Zero Groth16 receipt) is verified on-chain by the RISC Zero verifier
router — the same Nethermind-built verifier Stellar's Confidential Token preview uses — and the escrow releases.

No oracle, no custodian, no mocks: the evidence is the bank's own RSA signature.

```
seller ──create_offer──▶ ┌────────────────┐  verify(seal, image_id,  ┌──────────────────────────────┐
                         │  otc-escrow    │──sha256(journal))───────▶│ RISC Zero verifier router    │ (BN254 g1_mul + pairing_check)
buyer  ──lock──────────▶ │  (Soroban)     │◀──ok/err─────────────────│ → Groth16Verifier (Nethermind)│
buyer  ──fulfill(j,seal)▶└────────────────┘                          └──────────────────────────────┘
                              ▲  seal = 4-byte selector ‖ Groth16 (260 B), j = 152-byte journal
                              │
        .eml ──▶ zkotc-server (RISC Zero zkVM: DKIM RSA-SHA256 → MIME → Ziraat e-dekont) ──▶ seal, journal
```

## Repository
| Path | What | Status |
|---|---|---|
| `contracts/escrow` | Offer lifecycle, token custody, journal checks, nullifiers, fee, pause, upgrade; calls the RISC Zero router | 16 tests |
| `zkotc-lib` | zkVM-agnostic: DKIM verifier (RFC 6376), MIME extraction, Ziraat e-dekont parser, 152-byte journal | 8 tests incl. a real e-dekont e-mail |
| `prover` | **RISC Zero** guest (`zkotc-guest`, image id `0x4d8dc827…e384`), `zkotc` CLI (image-id / execute / prove), `zkotc-server` | ~3M cycles expected per e-dekont (to be measured on an outgoing sample) |
| `contracts/risc0-verifier-deployment.toml` | testnet deployment of [NethermindEth/stellar-risc0-verifier](https://github.com/NethermindEth/stellar-risc0-verifier) (router, timelock, Groth16 verifier v3.0.0, emergency stop) | routed, selector `73c457ba` |
| `web` | Next.js 16 app: offers, sell, reserve → pay → upload .eml → claim, wallet via Stellar Wallets Kit | `next build` clean |
| `docs` | PRD, UX copy, demo script, QA checklist | |

## Testnet deployments (Protocol 28)
| Contract | Id |
|---|---|
| otc-escrow (RISC Zero) | `CCTBLF3XKBUYDT2H6T7DLYB7R2BUX2KEB43FZS6A5BKOHLN4LLQZZCZF` |
| RISC Zero verifier router | `CBHIBH3T5ZZL6ZZZJFKS5QQKSB2VQ4D7GMBKQLNOQ7P2XBMPGVPG3FCG` |
| RISC Zero Groth16 verifier (params v3.0.0, selector 73c457ba) | `CAJXPOAJXOWAHTSIGZHBHRJCMYPF7JGR7ZZLBBSUZZZ3HW23YOGZKCQI` |
| Emergency stop / timelock | `CCKZKOFGJ2YHD7BWAH4JBGQQYCRFO4ELTK772LXMPUDDGMUTHYUUV2T4` / `CDJ47SNGJXWT435KYW4QO4QX262RUANOKLRGHC2PLW2YI7EQHFCQAMBR` |
Tokens: XLM SAC `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`, USDC SAC `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`.
Escrow config: lock 3600 s · fee 25 bps · ₺50–₺5 000 · trusted DKIM key `msg2._domainkey.ileti.ziraatbank.com.tr` (sha256 `dfc62dad…c806`).

## Run it
```sh
# contracts
cd contracts && cargo test && (cd escrow && stellar contract build)
./scripts/deploy-escrow-testnet.sh <image_id>   # image id from `zkotc image-id`

# shared library
cd zkotc-lib && cargo test

# prover (RISC Zero: curl -L https://risczero.com/install | bash && rzup install)
cd prover && cargo build --release
./target/release/zkotc image-id
./target/release/zkotc execute --eml my.eml --iban TR... --offer-id 1       # runs the guest in the executor (any machine)
RISC0_DEV_MODE=1 ./target/release/zkotc prove --eml my.eml --iban TR... --offer-id 1   # fake receipt, dev only
PORT=8787 ./target/release/zkotc-server                                     # HTTP prover, see below

# web
cd web && cp .env.example .env.local && npm i && npm run dev                # http://localhost:3000
```

## Generating real proofs (the only step that needs hardware or credits)
RISC Zero's Groth16 (STARK→SNARK) wrapper is **x86-only** (not Apple Silicon, not even in Docker). Options:
1. **x86 Linux box** (16+ vCPU, ≥16 GB, optionally an NVIDIA GPU with `--features cuda`): `rzup install risc0-groth16`, then run `zkotc-server`. One e-dekont proof is expected around 3M cycles (to be measured on an outgoing sample): the 4-vCPU VM took ~1h45m for a 6.7M-cycle guest, so use a GPU host (about a minute) for real users.
2. **Boundless** (RISC Zero's proof market, Base mainnet, paid in ETH): request a Groth16 receipt with the `boundless-market` SDK and feed `seal`/`journal` to `fulfill`.
On a Mac you can `execute` (exact journal, any machine) and, with `RISC0_DEV_MODE=1`, produce fake receipts for UI development — the router rejects them on-chain by design. Receipts must come from risc0 **3.0.x** (control root `a54dc85a…`), which is what the deployed verifier pins; a new RISC Zero major needs a new verifier version behind the router.

## Prover deployment
A real prover runs on an x86 Azure VM behind Caddy/TLS at `https://4-239-243-216.sslip.io` — see `docs/OPERATIONS.md` for deploy/update/rotate procedures.

## Prover API
`GET /info` → `{image_id, prover_mode, dkim_source}` · `POST /jobs {eml_base64, offer_id, recipient_iban, min_amount_kurus, since_yyyymmdd}` → job (fails fast with the exact DKIM/statement error) · `GET /jobs/{id}` → `queued | executing | proving | done | failed` with `proof`, `public_values`.
The e-mail is kept in memory only for the job; bodies are never logged. DKIM key from DNS (`DKIM_DNS=1`) or the pinned DER.

## Journal / public values (152 bytes)
`dkim_key_hash ‖ domain_hash ‖ recipient_iban_hash ‖ amount_kurus(u64) ‖ date_yyyymmdd(u64) ‖ nullifier ‖ offer_id(u64)`.
Escrow checks: router.verify(seal, image_id, sha256(journal)) · offer_id · DKIM key trusted · domain · IBAN hash == offer · amount ≥ price · Istanbul day(lock) ≤ date ≤ Istanbul day(now) · nullifier unused.

## History
The first iteration used SP1 with our own Soroban Groth16 verifier (verified a real SP1 proof on-chain). It was replaced by RISC Zero for ecosystem alignment; that code lives at git tag `sp1-backend`.

## Trust & limits (v1)
Only the bank can forge a DKIM signature (RSA-1024 key, pinned and rotatable). The prover sees the dekont of that one transfer; run your own or use TEE proving. Payer must bank with Ziraat. If a buyer pays after the 60-min lock ends and the seller releases the lock, the on-chain claim fails — the UI blocks payments with < 15 min left and warns sellers before releasing.
