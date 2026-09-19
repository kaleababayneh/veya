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
                              ▲  seal = 4-byte selector ‖ Groth16 (260 B), j = 184-byte journal
                              │
        .eml ──▶ zkotc-server (RISC Zero zkVM: DKIM RSA-SHA256 → MIME → Ziraat e-dekont) ──▶ seal, journal
```

## Repository
| Path | What | Status |
|---|---|---|
| `contracts/escrow` | Offer lifecycle, token custody, journal checks, nullifiers, fee, pause, upgrade; calls the RISC Zero router | 16 tests |
| `zkotc-lib` | zkVM-agnostic: DKIM verifier (RFC 6376), MIME extraction, Ziraat e-dekont parser, 184-byte journal | 8 tests incl. a real e-dekont e-mail |
| `prover` | **RISC Zero** guest (`zkotc-guest`, image id `0x9ec8ddc3…7cbf`), `zkotc` CLI (image-id / execute / prove), `zkotc-server` | 5.19M cycles on a real outgoing e-dekont |
| `contracts/risc0-verifier-deployment.toml` | testnet deployment of [NethermindEth/stellar-risc0-verifier](https://github.com/NethermindEth/stellar-risc0-verifier) (router, timelock, Groth16 verifier v3.0.0, emergency stop) | routed, selector `73c457ba` |
| `web` | Next.js 16 app: offers, sell, reserve → pay → upload .eml → claim, wallet via Stellar Wallets Kit | `next build` clean |
| `docs` | PRD, UX copy, demo script, QA checklist | |

## Proven end to end (2026-09-08 → full settlement 2026-09-10)
**First complete settlement on testnet, 2026-09-10 01:00 Istanbul:** offer #3 on escrow v4 (10 XLM for ₺50), reserved and
`declare_paid` by the buyer's Freighter wallet, a real ₺50 FAST transfer sent at 00:58, the e-dekont e-mail proved in ~15 s on
the GPU prover, and `fulfill` paid 9.975 XLM to the buyer and returned the seller's bond in one transaction:
[tx afdbb4c2…](https://stellar.expert/explorer/testnet/tx/afdbb4c22149d0143c35134b1c12a281ca619c4051191442d03a52cfcbc37fae).
A dry run earlier the same night with a 5-day-old receipt stopped exactly at `DateOutOfWindow`, i.e. after proof, payee and
amount verification, as the anti-replay rule requires.

A real Ziraat outgoing-FAST e-dekont → DKIM verified inside the RISC Zero guest (5.19M cycles) → Groth16 receipt
(84 min on the 4-vCPU Azure VM; **30 s on an RTX 4090**, see below) → **verified on Stellar testnet by the RISC Zero router**:
[tx 27a5f44d…](https://stellar.expert/explorer/testnet/tx/27a5f44d076e05f978237f55110e7212e38decf180f14d5472e14cfd8d8b36d3) (fee 0.022 XLM). Tampered journal or wrong image id are rejected.
The receipt (seal, journal, image id — no e-mail content) is in `contracts/testdata-real-receipt.json`.

**GPU timing (2026-09-09, Vast.ai RTX 4090, 32 vCPU EPYC, $0.36/h): 15 s end to end through the API** (was 84 min on
the CPU VM, 34 s on the first GPU run). STARK + succinct receipt 4.8 s (2.6M guest cycles, 3 segments), identity_p254
0.3 s, circom witness ~2–4 s in-process, Groth16 2.3 s on the GPU with a persistent [ICICLE-snark](https://github.com/ingonyama-zk/icicle-snark)
worker, plus upload, DNS key fetch and polling. The router accepts the seal; a tampered journal is rejected. RISC Zero's own
CUDA Groth16 wrap is not used because it crashes in 3.0.x ([risc0#3785](https://github.com/risc0/risc0/issues/3785)); the
reference CPU prover remains as a fallback engine (`GROTH16_NATIVE_DIR`, 19 s).
**Runbook: [`docs/GPU.md`](docs/GPU.md)** — rent a box and
`scripts/gpu/deploy.sh "<ssh line>" --switch` brings a prover up in ~4 minutes from prebuilt artifacts.

## Live demo
**https://zkotc.vercel.app** (Stellar testnet; deployed 2026-09-10 on request). The site is served over HTTPS, so the GPU prover is reached
through the Azure VM's TLS endpoint: `https://4-239-243-216.sslip.io/gpu` → Caddy `handle_path /gpu/*` → `http://<gpu box>:11267`
(`docs/OPERATIONS.md`). The Vercel project carries the `NEXT_PUBLIC_*` config plus `REVEAL_SECRET_KEY` (sensitive) for `/api/reveal`.

## Testnet deployments (Protocol 28)
| Contract | Id |
|---|---|
| otc-escrow v5 (P2P market: ads + reservations, encrypted payee, bonds) | `CAFU5GMKM3UNZ3VLOZ7HX5HDFB7L7U2HM3UZLYLTFHIQLILIEYN5SDLG` |
| otc-escrow v4 (single offers; retired 2026-09-10: emptied + paused) | `CBYZNQAOVAT5QDM6FQHKSWDOQDLA7AJ53PFZ6DLNC47A3YAR4KN6VCHV` |
| RISC Zero verifier router | `CBHIBH3T5ZZL6ZZZJFKS5QQKSB2VQ4D7GMBKQLNOQ7P2XBMPGVPG3FCG` |
| RISC Zero Groth16 verifier (params v3.0.0, selector 73c457ba) | `CAJXPOAJXOWAHTSIGZHBHRJCMYPF7JGR7ZZLBBSUZZZ3HW23YOGZKCQI` |
| Emergency stop / timelock | `CCKZKOFGJ2YHD7BWAH4JBGQQYCRFO4ELTK772LXMPUDDGMUTHYUUV2T4` / `CDJ47SNGJXWT435KYW4QO4QX262RUANOKLRGHC2PLW2YI7EQHFCQAMBR` |
Tokens: XLM SAC `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`, USDC SAC `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`.
Escrow config: lock 3600 s · proof window 7200 s after `declare_paid` · seller bond 5 % · late-claim window 3 days · fee 25 bps · ₺50–₺5 000 ·
trusted DKIM key `msg2._domainkey.ileti.ziraatbank.com.tr` (sha256 `dfc62dad…c806`) · image id of the GPU prover build (`eaf273e6…`).

**Market model (v5, 2026-09-10).** Like Binance P2P / zkP2P: makers post *ads* (a deposit of XLM/USDC, a price in ₺ per token,
min/max per trade, a nickname) and takers *reserve* any amount within the limits; the reservation fixes the TRY amount at the ad's
price, holds that slice for `lock_duration`, and is settled by the proof. Several buyers can trade against one ad at once
(`max_reservations_per_ad`, `max_active_per_buyer`). **Payee privacy:** the maker's IBAN + name are sealed in the browser to the
reveal service's X25519 key (`Config::reveal_pubkey`) and stored on-chain only as ciphertext plus `payee_hash`; the app's server route
`/api/reveal` opens them for the wallet that holds a reservation (or the maker) after a wallet-signed message, and the client refuses
to show them unless they hash to the on-chain commitment. Nothing on the ledger names a bank account.

**No .eml download (2026-09-10):** with a Google OAuth client id (`NEXT_PUBLIC_GOOGLE_CLIENT_ID`, see `docs/GMAIL-OAUTH.md`)
the reservation page fetches Ziraat's e-dekont from the buyer's Gmail in the browser (read-only token, never sent to us) and
submits the raw message to the prover; manual upload stays as the fallback.

**Trust model.** The buyer pays off-chain after reserving, so a timer alone would let the maker withdraw the moment it ends.
The escrow therefore has: `declare_paid` (the locked buyer records the payment; the lock is extended to at least
`proof_window`, during which only the buyer can release it); a seller bond (`bond_bps` of the amount, deposited with the
offer); and `claim_bond` (if the offer is released after a declared payment, the buyer who declared can still prove it
within `late_claim_window` and take the bond; otherwise the seller gets it back via `withdraw_bond` or automatically).
A takeover of a stale lock counts as a release, so a seller cannot dodge the bond by letting a second buyer settle.
**Wallet binding (2026-09-10):** the buyer types a payment reference `ZKOTC <offer> <6 hex of sha256(wallet)>` into the
FAST description; the guest requires it in the signed dekont and commits its hash, and the escrow recomputes it from the
offer id and the claiming wallet. A stolen `.eml` therefore settles nothing for anyone but the wallet it was paid for.
The parser also anchors the transfer direction on three bank-generated rows (title, `Fast Mesaj Kodu` prefix, last
settlement sentence) and treats everything after `Açıklama :` as untrusted text, and the guest refuses DKIM signatures
with an `l=` body-length limit.
Residual risks: a buyer can delay a seller by the proof window without paying (no buyer bond yet), and a proof that
arrives after the late-claim window is not compensated.

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
1. **x86 Linux box** (16+ vCPU, ≥16 GB, optionally an NVIDIA GPU with `--features cuda`): `rzup install risc0-groth16`, then run `zkotc-server`. One e-dekont proof is 5.19M cycles: the 4-vCPU VM needs on the order of an hour; use a GPU host (about a minute) for real users.
2. **Boundless** (RISC Zero's proof market, Base mainnet, paid in ETH): request a Groth16 receipt with the `boundless-market` SDK and feed `seal`/`journal` to `fulfill`.
On a Mac you can `execute` (exact journal, any machine) and, with `RISC0_DEV_MODE=1`, produce fake receipts for UI development — the router rejects them on-chain by design. Receipts must come from risc0 **3.0.x** (control root `a54dc85a…`), which is what the deployed verifier pins; a new RISC Zero major needs a new verifier version behind the router.

## Prover deployment
A real prover runs on an x86 Azure VM behind Caddy/TLS at `https://4-239-243-216.sslip.io` — see `docs/OPERATIONS.md` for deploy/update/rotate procedures.

## Prover API
`GET /info` → `{image_id, prover_mode, dkim_source}` · `POST /jobs {eml_base64, offer_id, recipient_iban, min_amount_kurus, since_yyyymmdd}` → job (fails fast with the exact DKIM/statement error) · `GET /jobs/{id}` → `queued | executing | proving | done | failed` with `proof`, `public_values`.
The e-mail is kept in memory only for the job; bodies are never logged. DKIM key from DNS (`DKIM_DNS=1`) or the pinned DER.

## Journal / public values (184 bytes)
`dkim_key_hash ‖ domain_hash ‖ payee_hash ‖ amount_kurus(u64) ‖ date_yyyymmdd(u64) ‖ nullifier ‖ reservation_id(u64) ‖ reference_hash`.
`reference_hash = sha256("ZKOTC <reservation id> <6 hex of sha256(claiming wallet)>")` — the buyer types that reference into the FAST description, so a stolen e-mail settles nothing for another wallet.
`payee_hash = sha256("zkotc/payee/v1" ‖ TRcc ‖ bank code(5) ‖ last 6 IBAN digits ‖ Turkish-folded recipient name)` — Ziraat's dekont masks IBANs, so the binding uses the visible check digits, bank code, IBAN tail and the recipient name; the escrow derives the same hash from the seller's full IBAN + name.
Escrow checks: router.verify(seal, image_id, sha256(journal)) · reservation_id · DKIM key trusted · domain · payee_hash == ad · amount (İşlem Tutarı) ≥ reservation's TRY · reference_hash == sha256(payment_reference(reservation, wallet)) · Istanbul day(reservation) ≤ date ≤ Istanbul day(now) · nullifier unused.

## History
The first iteration used SP1 with our own Soroban Groth16 verifier (verified a real SP1 proof on-chain). It was replaced by RISC Zero for ecosystem alignment; that code lives at git tag `sp1-backend`.

## Trust & limits (v1)
Only the bank can forge a DKIM signature (RSA-1024 key, pinned and rotatable). The prover sees the dekont of that one transfer; run your own or use TEE proving. Payer must bank with Ziraat. If a buyer pays after the 60-min lock ends and the seller releases the lock, the on-chain claim fails — the UI blocks payments with < 15 min left and warns sellers before releasing.
