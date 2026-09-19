# PRD — stellarpro: P2P TRY ⇄ XLM/USDC OTC with zk proof-of-payment on Stellar

Status: v1 for Stellar Pro Hackathon (Istanbul, 18–20 Sep 2026). Owner: PM. Engineering: escrow contract, RISC Zero guest, prover API, web app.

## 1. Problem & why now
| | |
|---|---|
| Problem | A person in Türkiye holding TRY has no self-custodial way to buy XLM/USDC from a peer without trusting the peer or a CEX. A seller of crypto cannot verify a TRY bank transfer happened without trusting a screenshot. |
| Why now | (1) **FAST** makes every TRY bank transfer instant, 24/7, with IBAN + name in the record. (2) **Ziraat Bankası** e-mails a per-transaction **e-dekont** that is **DKIM-signed** (`ileti.ziraatbank.com.tr`, RSA-1024/SHA-256) and states date, time, fiş no, counterparty and amount of one FAST/EFT. (3) **Stellar Protocol 25+** exposes native BN254 pairing on Soroban; our verifier already verifies an RISC Zero Groth16 receipt on testnet for ~27.4M CPU insns. |
| Thesis | Escrow on Soroban + a zk proof that "the bank's own signed e-mail contains a FAST payment of ≥ X TRY to the seller's IBAN on/after the lock date" = trust-minimised on-ramp with no oracle, no KYC provider, no custodian. |

## 2. Personas & jobs-to-be-done
| Persona | Has | Wants | JTBD |
|---|---|---|---|
| **Seller** (Ayşe) | XLM or USDC on Stellar testnet, a Ziraat/any Turkish IBAN | TRY in her bank account, no chargeback risk | "Post a fixed-price offer, get paid to my IBAN, release crypto only when payment is proven." |
| **Buyer** (Mehmet) | TRY in a **Ziraat** account (v1: payer must bank with Ziraat), Freighter wallet | Crypto without a CEX, no trust in a stranger | "Reserve an offer, pay by FAST, prove it from the bank's e-dekont e-mail for that transfer, receive the crypto automatically." |
| Admin (team) | deploy key | keep the system safe | pause, allow tokens, rotate DKIM keys. |

## 3. Scope (v1)
In: single-fill fixed-amount offers; XLM and USDC (Circle testnet issuer); Ziraat as payer bank; Freighter wallet; self-hosted prover; English UI with Turkish bank instructions.
Out: partial fills, order matching, other payer banks, fiat→fiat, mobile wallet deep-links, dispute arbitration, mainnet.

## 4. Offer lifecycle
```
            seller:create                buyer:lock                      buyer:fulfil(proof)
 (none) ───────────────▶ OPEN ───────────────────────▶ LOCKED ───────────────────────────▶ FULFILLED
                          │  ▲                           │
   seller:cancel          │  │ buyer:release (any time)  │
   (only when OPEN) ◀─────┘  │ seller:unlock (only after lock_expiry)
        ▼                    └───────────────────────────┘
   CANCELLED
 OPEN + now ≥ offer_expiry ⇒ seller:reclaim ⇒ EXPIRED   (a LOCKED offer cannot expire until unlocked)
```
| State | Meaning | Allowed transitions (actor) |
|---|---|---|
| OPEN | tokens escrowed, no buyer | lock (any wallet ≠ seller) · cancel (seller) · reclaim after offer_expiry (seller) |
| LOCKED | reserved for `buyer`, `locked_at`, `lock_expiry = locked_at + LOCK_SECS` | fulfil (buyer, **allowed even after lock_expiry while still LOCKED**) · release (buyer) · unlock (seller, only `now ≥ lock_expiry`) |
| FULFILLED | tokens − fee → buyer, fee → treasury | terminal |
| CANCELLED / EXPIRED | tokens → seller | terminal |

## 5. Rules (encode exactly)
| Rule | Decision | Rationale |
|---|---|---|
| LOCK_SECS | **3600 s (60 min)** | Buyer path: FAST (≤1 min) → request the transfer's e-dekont e-mail (arrives in ~2 min) → download .eml (1 min) → proof (2–10 min) → tx. ~15 min typical; 60 min absorbs bank/app hiccups while not freezing seller liquidity for hours. Not extendable in v1. |
| Payment warning | UI blocks the "I have paid" step when < **15 min** remain and tells the buyer to release and re-lock instead of paying | Prevents the trust-gap in §6. |
| Offer expiry | seller picks 1 h – 30 d, default **7 d**; enforced on-chain | liquidity hygiene |
| Amounts (testnet) | TRY leg **50 ≤ try_amount ≤ 5 000**; token leg > 0; both fixed per offer (no partial fills) | keeps demo payments real and cheap |
| Amount tolerance | proven `amount_kurus` **≥ offer.try_amount_kurus**; UI says "send exactly X" | exact-match fails on buyer rounding; overpay is buyer's choice |
| Currency | dekont amount must be in TL/TRY | Ziraat TRY account only in v1 |
| Fee | **25 bps** of the token leg, taken at fulfil, sent to `treasury`; admin-settable, hard cap 100 bps | comparable to on-ramp rails; visible before lock |
| Date window | `payment_date` (dd/mm/yyyy from the dekont, Istanbul local) must satisfy **istanbul_date(locked_at) ≤ payment_date ≤ istanbul_date(ledger_now)**, Istanbul = UTC+3 fixed (no DST since 2016) | statement has no time-of-day; payments before the lock are not accepted (prevents recycling an unrelated earlier payment) |
| Payee match | `payee_hash` from proof == `offer.payee_hash`, where payee_hash = sha256(TRcc ‖ bank code ‖ last 6 IBAN digits ‖ folded recipient name) | Ziraat dekonts mask IBANs (`TR37 **** … 0000 01`) but print recipient name and bank |
| Sender bank | e-mail `From` domain hash == `ileti.ziraatbank.com.tr`; DKIM key hash ∈ contract's trusted set | only bank-signed evidence |
| Binding | public values include `offer_id` and `buyer` address; contract checks both | proof cannot be redirected |
| Nullifier | sha256(domain ‖ Fast Sorgu No ‖ payer account ‖ date ‖ time ‖ fiş no ‖ amount ‖ description ‖ settlement); contract stores used nullifiers forever | one bank transfer fulfils at most one offer |
| Tokens | admin allow-list: native XLM SAC, USDC (`GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` on testnet) | |
| Pause | admin can pause create/lock; fulfil/release/cancel/reclaim always work | never trap funds |
| Seller identity on-chain | v1 stores plaintext `payee_iban` + `payee_name` in the offer (needed for FAST) **with explicit consent copy**; v1.1: store only `iban_hash`, deliver plaintext to the locked buyer via the API | ship reliability first; IBANs are routinely shared with counterparties |

## 6. Known trust gap and mitigation
Scenario: buyer pays, proof is late, `lock_expiry` passes, seller calls `unlock` and re-sells. Buyer has paid TRY and gets nothing on-chain.
| Mitigation | v1 |
|---|---|
| fulfil stays valid while LOCKED even after expiry (only an explicit `unlock` ends it) | yes |
| Buyer UI: countdown; hard stop on paying with < 15 min left | yes |
| Seller UI on `unlock` of an expired lock: "The buyer may already have paid you. Check your bank before unlocking. This cannot be undone." + 5-second hold | yes |
| Event `Unlocked{after_expiry: true, buyer}` emitted so the buyer can show evidence (e-mail proof) off-chain | yes |
| Seller bond / arbitration / auto-refund | v2 |

## 7. Security & privacy
| Topic | Decision |
|---|---|
| DKIM key rotation | contract keeps `trusted_dkim_keys: Map<domain_hash, Vec<key_hash>>`; admin add/remove; proof fails with `DkimKeyNotTrusted` otherwise. Monitor `msg2._domainkey.ileti.ziraatbank.com.tr` daily. |
| RSA-1024 DKIM key | acknowledged weakness; only the bank could forge; acceptable for testnet; document in demo. |
| What leaves the browser | the **entire .eml** (one transfer's dekont: your IBAN, name, the counterparty, the amount) goes to the prover. |
| Prover modes | (A) **Team-hosted x86 prover** (v1 default) — disclosed in UI, e-mail deleted ≤ 1 h after job end, no body logging. (B) **Self-hosted** by buyer (Docker image, x86) — recommended in UI for power users. (C) Succinct Prover Network — **only with TEE private proving**; otherwise not acceptable. |
| Consent | mandatory checkbox before upload quoting the exact data shared and retention. |
| On-chain footprint | only: offer_id, buyer, hashes (dkim key, domain, payee IBAN), amount_kurus, payment_date, nullifier. Never the dekont or payer IBAN. |

## 8. Acceptance criteria (testable)
| # | Feature | Given / When / Then |
|---|---|---|
| A1 | Create offer | Given Ayşe holds 100 USDC, when she creates offer (100 USDC ↔ 4 000 TRY, IBAN, name, 7 d), then escrow holds 100 USDC, offer is OPEN, listed within 10 s. |
| A2 | Lock | When Mehmet locks, then status LOCKED, `lock_expiry = locked_at + 3600`, UI shows IBAN, name, exact TRY amount, countdown. |
| A3 | Seller cannot cancel locked | When Ayşe calls cancel during LOCKED, then `LockActive`. |
| A4 | Unlock after expiry | When 3600 s pass and Ayşe calls unlock, then OPEN, event `after_expiry=true`. |
| A5 | Proof happy path | Given a real Ziraat .eml with FAST row ≥ 4 000 TRY to Ayşe's IBAN dated ≥ lock date, when Mehmet uploads, then prover returns proof in ≤ 10 min, fulfil tx succeeds, Mehmet gets 99.75 USDC, treasury 0.25 USDC, status FULFILLED. |
| A6 | Wrong IBAN | Row to another IBAN ⇒ `IbanMismatch`, funds untouched. |
| A7 | Too low | Row 3 999,99 TRY ⇒ `AmountTooLow`. |
| A8 | Old payment | Row dated before lock date ⇒ `DateOutOfWindow`. |
| A9 | Replay | Same .eml row used on a second offer ⇒ `NullifierUsed`. |
| A10 | Forged mail | Modified attachment ⇒ prover fails DKIM (job `failed`, never reaches chain). |
| A11 | Foreign key | E-mail signed with an untrusted selector ⇒ `DkimKeyNotTrusted`. |
| A12 | Pause | Admin pauses ⇒ create/lock revert `Paused`; fulfil/release/cancel still work. |
| A13 | Verify cost | fulfil tx ≤ 100M CPU insns. |
| A14 | Disclosure | Upload button disabled until consent checkbox checked. |
