# zkOTC — P2P TRY ⇄ XLM/USDC on Stellar, settled by a zero-knowledge proof of the bank transfer

A peer-to-peer market like Binance P2P, minus the platform holding money or judging disputes. Makers post XLM or USDC
liquidity with a TRY price in a Soroban escrow. A buyer reserves an amount, pays the maker by an ordinary **FAST** transfer
from a **Ziraat** or **VakıfBank** account, and asks the bank to e-mail the transfer's receipt (*e-dekont*). That e-mail is DKIM-signed by the bank; a
RISC Zero zkVM program verifies the signature and reads the receipt, a GPU wraps it into a Groth16 proof in about **15 s**,
and the escrow pays out only when Stellar's RISC Zero verifier router accepts the proof. No oracle, no custodian, no
screenshots: the evidence is the bank's own RSA signature, and a payment reference typed into the transfer binds it to the
claiming wallet.

**Try it:** https://www.veya.lol (Stellar testnet, Freighter). Paying needs a Ziraat account; anyone can post an ad with
testnet XLM ([Friendbot](https://lab.stellar.org/account/fund?$=network$id=testnet)) or open a settled trade from the
market page to see a real proof. Built for the Stellar Pro Hackathon, Istanbul, 18–20 September 2026.

| | |
|---|---|
| Proof time | ~15 s end to end on a rented RTX 4090 (STARK 5 s, Groth16 wrap 3 s, the rest is I/O); 84 min on a 4-vCPU CPU box |
| Cost | ≈ $0.003 per proof at $0.36/h; the box is rented per day from a one-command runbook (`docs/GPU.md`) |
| On-chain | 260-byte Groth16 seal + 184-byte journal, verified by the RISC Zero verifier router (Nethermind) in one settlement transaction |
| First real trade | 12 Sep 2026: ₺50 FAST with reference `ZKOTC 7 089340`, proof 12.8 s, settled on testnet (reservation #7) |
| Trust today | funds are safe from other users and the counterparty; the single operator can read makers' IBANs and change the accepted zkVM program — stated on the site, timelock + enclave on the roadmap |
| Two rails | buyers use the peer market (no KYC, proof of receipt); makers refill USDC inventory and cash out through a Turkish anchor via the standard SEP client path (SEP-1 discovery, SEP-10 login, SEP-6 deposit/withdraw, SEP-38 quotes; `tr-mock-anchor.fly.dev` on testnet) — the anchor's rate is shown on the market as the price to beat |

```
maker  ──create_ad(liquidity, price, limits, sealed IBAN)──▶ ┌──────────────────┐
buyer  ──reserve(amount) ─ reveal IBAN (wallet signature) ──▶ │  otc-escrow v5   │   verify(seal, image_id, sha256(journal))
buyer  ──FAST ₺ + "ZKOTC<id><code>" ─ declare_paid ────────▶ │  (Soroban)       │ ─────────────────────────────────────────▶ RISC Zero verifier router → Groth16Verifier
buyer  ──settle(journal, seal) ────────────────────────────▶ └──────────────────┘ ◀── ok ── pays buyer, frees the maker's bond slice
                                                                     ▲
   e-dekont .eml ──▶ /api/prove (wallet-signed, on-chain check) ──▶ zkotc-server on the GPU box: DKIM RSA-SHA256 → MIME → Ziraat parser → STARK → Groth16
```

## Repository
| Path | What | Tests |
|---|---|---|
| `contracts/escrow` | Market escrow v5: ads, reservations, quotes, `declare_paid` protection, per-reservation bond slices, wallet-bound reference, nullifiers, admin/upgrade; calls the RISC Zero router | 21 |
| `zkotc-lib` | zkVM-agnostic core: DKIM verifier (RFC 6376), MIME/attachment extraction, bank providers chosen by DKIM domain — Ziraat e-dekont HTML parser, VakıfBank Dekont.pdf extractor + parser — hardened against description injection, 184-byte journal | 16 unit + 10 on real e-mails |
| `prover` | RISC Zero guest (`prover/IMAGE_ID`), `zkotc` CLI, `zkotc-server` (jobs API, GPU Groth16 via ICICLE or the reference CPU prover) | |
| `web` | Next.js 16: market (with the anchor's price to beat), ads, reservation wizard, `/api/reveal` (sealed IBAN → reserving wallet), `/api/prove` (gate to the prover), `/anchor` (SEP-1/10/6/38 client for makers), SEP-1 `stellar.toml` | lint + types + build in CI |
| `scripts/gpu` | Rent-and-deploy runbook for the GPU prover (artifacts on an Azure host, HTTPS via Caddy, escrow switch) | |
| `docs` | **`TECHNICAL-DESIGN.md`** (architecture, one trade end to end, what the guest and the escrow verify, trust model, decisions, challenges), `ROADMAP.md`, `GPU.md`, `OPERATIONS.md`, PRD, demo script, QA checklist | |

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

**Getting the e-mail to the prover (2026-09-12):** Ziraat only sends the e-dekont to the address registered with the bank, so the
buyer hands the original message to the app: in Gmail on a computer, ⋮ → *Show original* → *Download original*, and drops the `.eml` on the reservation page. Plain forwarding re-wraps the message and breaks the DKIM signature, so it is refused.
Gmail OAuth was built and dropped: Google's restricted-scope verification (CASA) is needed before anyone but listed test users can
sign in. The production path is an inbound address per wallet (`<token>@in.<domain>`, Cloudflare Email Routing) that the buyer
forwards Ziraat's mail to once; Gmail auto-forwarding keeps DKIM intact.

**Trust model.** The buyer pays off-chain after reserving, so a timer alone would let the maker withdraw the moment it ends.
The escrow therefore has: `declare_paid` (the locked buyer records the payment; the lock is extended to at least
`proof_window`, during which only the buyer can release it); a seller bond (`bond_bps` of the amount, deposited with the
offer); and `claim_bond` (if the offer is released after a declared payment, the buyer who declared can still prove it
within `late_claim_window` and take the bond; otherwise the seller gets it back via `withdraw_bond` or automatically).
A takeover of a stale lock counts as a release, so a seller cannot dodge the bond by letting a second buyer settle.
**Wallet binding (2026-09-10):** the buyer types a payment reference `ZKOTC<offer><6 hex of sha256(wallet)>` (one token) into the
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
A real prover runs on a rented GPU box (RTX 4090, ~15 s per proof) behind an HTTPS tunnel; the web app reaches it only through its own `/api/prove` routes. `docs/GPU.md` is the runbook: prebuilt binaries are kept on the deploying machine, the box fetches the public zkey itself.

## Prover API
`GET /info` → `{image_id, prover_mode, dkim_source}` · `POST /jobs {eml_base64, offer_id, recipient_iban, min_amount_kurus, since_yyyymmdd}` → job (fails fast with the exact DKIM/statement error) · `GET /jobs/{id}` → `queued | executing | proving | done | failed` with `proof`, `public_values`.
The e-mail is kept in memory only for the job; bodies are never logged. DKIM key from DNS (`DKIM_DNS=1`) or the pinned DER.

## Journal / public values (184 bytes)
`dkim_key_hash ‖ domain_hash ‖ payee_hash ‖ amount_kurus(u64) ‖ date_yyyymmdd(u64) ‖ nullifier ‖ reservation_id(u64) ‖ reference_hash`.
`reference_hash = sha256("ZKOTC<reservation id><6 hex of sha256(claiming wallet)>")` — the buyer types that reference into the FAST description, so a stolen e-mail settles nothing for another wallet.
`payee_hash = sha256("zkotc/payee/v1" ‖ TRcc ‖ bank code(5) ‖ last 6 IBAN digits ‖ Turkish-folded recipient name)` — Ziraat's dekont masks IBANs, so the binding uses the visible check digits, bank code, IBAN tail and the recipient name; the escrow derives the same hash from the seller's full IBAN + name.
Escrow checks: router.verify(seal, image_id, sha256(journal)) · reservation_id · DKIM key trusted · domain · payee_hash == ad · amount (İşlem Tutarı) ≥ reservation's TRY · reference_hash == sha256(payment_reference(reservation, wallet)) · Istanbul day(reservation) ≤ date ≤ Istanbul day(now) · nullifier unused.

## History
The first iteration used SP1 with our own Soroban Groth16 verifier (verified a real SP1 proof on-chain). It was replaced by RISC Zero for ecosystem alignment; that code lives at git tag `sp1-backend`.

## Trust & limits (testnet, September 2026)
- **What cannot happen:** nobody takes tokens without a valid proof of a bank transfer to the maker's committed IBAN for that
  reservation's amount and date window; a receipt cannot be forged or edited (Ziraat's DKIM signature covers the body hash);
  a stolen e-mail is useless to any wallet but the one its `ZKOTC<id><code>` reference names; a receipt settles once (nullifier).
- **What the operator can do today:** read makers' bank details (the reveal key is held server-side), see the e-mails buyers
  upload (memory only), and change the accepted guest image id, DKIM key set or contract code with the admin key, with no delay.
  Every such change is a public transaction. Production plan: timelock on admin actions, reproducible guest build, multisig, and
  the reveal key inside an attested enclave (`docs/ROADMAP.md` §C).
- **Other limits:** payers must bank with Ziraat or VakıfBank; both banks' DKIM keys are RSA-1024 (only the bank can forge, but weak by
  today's standards); the .eml must be downloaded from a computer (phones cannot export it); a proof after the 3-day bond window
  is not compensated; a buyer can delay a maker by the 2-hour protection window without paying.

VAKIF