# zkOTC roadmap — hackathon submission and beyond

**Status 2026-09-12.** The core is complete and proven with real data: Ziraat's DKIM-signed e-dekont verified inside
the RISC Zero guest, Groth16 wrapped on a rented GPU in ~15 s, verified on Stellar testnet by Nethermind's verifier
router, market escrow v5 (ads + reservations, encrypted payee, declare/bond protection, wallet-bound payment reference).
First dekont with a typed reference arrived today (reservation #7); the parser fix for Ziraat's real layout is built
and being switched in. What remains for the submission is verification, operations and polish, not cryptography.

Hackathon: **Stellar Pro, Istanbul, 18–20 September 2026.** Submission target: **17 September**, so the 18th–20th are
for the demo, not for code.

Legend: **Done** · **Dropped** (decided against, with the reason) · **Open** (still to do) · **Partial**.

---

## A. What the three earlier plans asked for, and where each item stands

The plans of 8, 9 and 10 September, merged and de-duplicated. Item numbers are new; the old wording is kept where useful.

### A1. Close the loop
| # | Item | Status |
|---|---|---|
| 1 | Real Groth16 receipt through settlement on testnet | **Done 2026-09-08/10.** First receipt verified by the router (tx 27a5f44d…), first full settlement with a real ₺50 FAST (v4 offer #3, tx afdbb4c2…). |
| 2 | Real ₺50 FAST through the UI with Freighter on both sides, on v5 | **Partial.** Reserve → reveal (wallet signature) → pay → declare done in the browser on v5 (reservations #2–#7). Settlement of #7 pending the parser fix rollout today. Bond path (`claim_bond` after a release) never exercised in the UI. |
| 3 | Point the app at the GPU prover, HTTPS in front, proof phases live | **Done 2026-09-10/12.** One-command rental (`docs/GPU.md`): prebuilt binaries from the Azure artifact host, Caddy `/gpu/*` re-pointed automatically, progress bar per proof phase. |
| 4 | Pin the guest image id in the repo + CI (lib, contract, guest, web) | **Open.** Two silent invalidations happened on 9 Sep and one guest change today; `deploy.sh` now checks the escrow config, but nothing in CI does. |
| 5 | Prover hardening: persistent jobs, wallet auth, rate limits, auto-start on boot | **Partial.** Queue cap (`MAX_JOBS_QUEUED`), shared token, CORS. Still in-memory jobs, token public in the bundle, no per-wallet limit, `nohup` server dies with the container. |

### A2. Trust and safety
| # | Item | Status |
|---|---|---|
| 6 | Trust gap: `declare_paid` freeze + seller bond slashed against a late valid proof | **Done 2026-09-09 (v4), carried into v5.** `proof_window` 2 h, 5 % bond per reservation, `claim_bond` within 3 days, `reclaim_bond` after. |
| 7 | Wallet binding: payment reference in the FAST description | **Done 2026-09-10; format change pending.** Proof commits `reference_hash`, escrow recomputes it from (reservation id, claiming wallet). Real dekont confirmed the mechanism today. Single-token form `ZKOTC7089340` is on branch `compact-reference`, deployed after #7 settles (it was paid with the spaced form). |
| 8 | Parser hardening against description injection; `l=` DKIM refusal | **Done 2026-09-10, extended 2026-09-12.** Bank fields are read only from the block after the last `Fast Mesaj Kodu :` anchor; payer text before it is untrusted. Injection tests for prefix and tail layouts. |
| 9 | DKIM key registry contract with validity windows, timelock, daily monitor | **Open (post-hackathon).** Today: fixed key set in the escrow config, admin-only. |
| 10 | Prover privacy: TEE with attestation, self-host image | **Open (post-hackathon).** Prover sees the full e-mail; e-mails live only in memory for the job. |
| 11 | DKIM verifier and parser assurance: differential tests vs dkimpy, fuzzing, property tests | **Partial.** Real-mail regression tests (outgoing, incoming, with-reference), tamper and `l=` tests, injection tests. No fuzzing or differential corpus yet. |
| 12 | Escrow review: TTL/archival, event schema, admin multisig, external audit | **Open.** 21 contract tests; no external review. |
| 13 | Admin power: the operator can change `image_id`, upgrade the contract, change DKIM keys (raised 2026-09-12) | **Open.** Fix = timelock longer than any lock on `set_config`/`upgrade`/DKIM changes, reproducible guest build (`RISC0_USE_DOCKER=1`) so the id can be checked against the source, multisig admin. State it plainly in the UI until then. |

### A3. Product and UX
| # | Item | Status |
|---|---|---|
| 14 | Seller IBAN privacy: only a hash on-chain, reveal to the reserving wallet after wallet auth | **Done 2026-09-10 (v5).** Sealed box to the market's X25519 key, `/api/reveal` checks signature + on-chain reservation, client verifies against the hash. Operator can read the key → **attested reveal service** is the production follow-up. |
| 15 | Partial fills → market model (ads, reservations, quotes, limits) | **Done 2026-09-10 (v5).** Binance-P2P-style: makers post liquidity with price and limits, takers reserve any amount. |
| 16 | Remove the .eml step: Gmail OAuth (`gmail.readonly`) | **Built 2026-09-10, dropped 2026-09-12.** Restricted scope: only whitelisted test users can sign in until Google's CASA verification, incompatible with an open demo. |
| 17 | Remove the .eml step: inbound address per wallet + Gmail forwarding rule | **Designed and shelved 2026-09-12.** Ziraat only mails the registered address, so the buyer would need a one-time forwarding rule; judged too much friction for the hackathon. Inbox service drafted (`scripts/inbox`, not committed). Production path. |
| 18 | UI pass: step cards, mobile market cards, mobile nav, copy | **Done 2026-09-10/12** (reservation wizard with one active step, copyable transfer card, drop zone, collapsed terms). **Open:** toasts, skeletons, Turkish copy toggle, wallet-not-installed hint, seeded ads. |
| 19 | Maker dashboard on the ad page (fills, reservations, bond) | **Partial.** Stats, price change, close, reveal own payee, reservation list exist; no per-reservation actions or bond view. |
| 20 | Activity view from Soroban events; indexer + notifications | **Open.** `/me` scans via RPC; no indexer, no alerts. |
| 21 | Bank-provider abstraction, second bank | **Open (post-hackathon).** Only DKIM-signed receipts qualify; each bank needs a parser. |
| 22 | Onboarding: sponsored trustlines, wallet kit on mobile, Turkish UI | **Open.** |
| 23 | Market economics: oracle-pegged price with spread, buyer bond, reputation | **Open.** Counters (settled/active) exist; no pegging, no buyer deposit. |

### A4. Operations and mainnet
| # | Item | Status |
|---|---|---|
| 24 | GPU box: fixed host or reproducible rental | **Done 2026-09-12** as reproducible rental: `deploy.sh "<ssh line>"` from nothing to serving in ~4–10 min, artifacts on Azure, escrow/proxy handled. Open: on-start script on the box, prover-offline banner in the app. |
| 25 | Key custody: reveal secret and admin key out of `.env` into a KMS, later a TEE; timelock/multisig | **Open.** |
| 26 | Metrics, alerts, incident playbook | **Open.** `docs/OPERATIONS.md` covers restarts and logs only. |
| 27 | Legal review (Türkiye: Law 7518 CASP regime, MASAK), mainnet verifier behind a timelock, audit, USDC mainnet, fee model | **Open.** Not a hackathon item. |
| 28 | Demo rehearsal, README top section, demo script, backup video | **Partial.** `docs/DEMO-SCRIPT.md` exists; no rehearsal on v5 yet, no video. |

---

## B. Plan to the submission (12 → 17 September)

Ordered by risk. "You" = needs a real bank transfer or a wallet you hold; "me" = engineering.

### Day 0 (today, 12 Sep) — finish the loop on real data
- [ ] **Parser rollout** (me, running): guest rebuilt with the typed-açıklama fix, published to Azure, escrow switched.
- [ ] **Settle reservation #7** (you): drop `DEKONT (3).eml` again, claim. First settlement with a wallet-bound reference.
- [ ] **Single-token reference** (me): merge `compact-reference`, upgrade the escrow in place, incremental host rebuild + publish, redeploy web.
- [ ] **Verify before the box is destroyed** (me): published `bin/latest` = running binary, escrow image id = published build, proof round-trip through the HTTPS proxy.

### 13–14 Sep — make it survive contact with strangers
- [ ] **Prover auth and limits** (me, ½ day): wallet-signed job creation (same scheme as the reveal route), require a live reservation on-chain for that wallet, per-wallet cap, drop the shared token from the bundle.
- [ ] **Prover persistence and restart** (me, ½ day): SQLite job store; Vast on-start script runs `bootstrap.sh` so a container restart brings the server back; "prover offline" banner on step 3.
- [ ] **Image id pin + CI** (me, ½ day): `prover/IMAGE_ID` checked against the escrow config; GitHub Actions for lib tests, contract tests, web lint/build.
- [ ] **Every path once on testnet** (you + me, 1 h): USDC ad, unpaid reservation expiring, maker release after the window then `claim_bond`, `reclaim_bond`.
- [ ] **Visitors without a Ziraat account** (me, ½ day): a "watch a settled trade" page (proof tx, decoded journal, timings) and testnet-XLM guidance for makers, so the open test is not a wall.

### 15–16 Sep — polish
- [ ] Toasts for transaction results, skeleton loaders, explicit empty and error states, wallet-not-installed hint.
- [ ] "Continue on a computer" link on the phone view (paying happens on the phone, proving on a laptop).
- [ ] Turkish copy for steps 2 and 3 (bank-facing labels already in Turkish).
- [ ] Maker dashboard: per-ad row with active/settled counts, bond state, one-click price change.
- [ ] Seed 3–4 ads under different nicknames; a second Ziraat-paying tester if available.
- [ ] Trust statement on How-it-works: what the operator can and cannot do today (admin key, reveal key, prover sees the e-mail).

### 17 Sep — submission
- [ ] README top section: what it is, the 15 s number, live links, trust model, how to try it.
- [ ] Demo rehearsal on v5 with a reservation paid an hour before; the .eml already downloaded; backup video of the full loop.
- [ ] Rent the demo box the evening before the event and keep it through the 20th (~$26); confirm the proxy and escrow after deploy.

---

## C. After the hackathon — production

### C1. Weeks 1–4: trust that does not depend on the operator
1. **Timelock** on `set_config` (image id, DKIM keys, verifier), `upgrade` and `set_admin`; delay longer than the maximum reservation + proof window. Events for every pending change.
2. **Reproducible guest build** (`RISC0_USE_DOCKER=1`) and a published build recipe, so anyone can map the configured image id to the source.
3. **Attested reveal service**: the X25519 reveal key generated inside an SGX enclave (Gramine), remote attestation with the enclave measurement pinned in the escrow config and checked by the maker's browser before sealing.
4. **Multisig admin**, then reduce admin scope.
5. **DKIM key registry** contract with validity windows and a daily monitor of Ziraat's selector; key rotation must not stop the market.
6. **Assurance**: differential DKIM tests against dkimpy over a corpus, fuzzing of the parser and the attachment-hint verifier, external escrow review.

### C2. Months 2–3: product
7. **Inbound address flow** (item 17): `<token>@in.<domain>` via Cloudflare Email Routing → inbox service, Gmail forwarding confirmation code shown on the page, proving starts when the dekont lands. Repeat users never touch an .eml.
8. **Prover privacy**: prover inside a TEE with attestation, or a local CLI path; written privacy policy.
9. **Indexer and notifications**: events into Postgres, activity pages, Telegram/e-mail alerts for reservation, expiry, settlement.
10. **Market economics**: Reflector-pegged prices with a maker spread, small buyer deposit against reserve-and-vanish, reputation from settled/released counts.
11. **Onboarding**: sponsored USDC trustlines, Turkish UI, mobile wallet kit.
12. **Second bank** through a provider abstraction (domain, parser, nullifier, provider id in the journal); pick by user demand.

### C3. Mainnet gates
13. **Legal review** for Türkiye (Law 7518 crypto-asset service providers, MASAK AML) before any mainnet talk; document the non-custodial model and decide on limits.
14. Mainnet verifier router behind a real timelock, escrow audit, USDC mainnet, treasury and fee model covering proving cost (~$0.003 per proof on a rented 4090).
15. Incident playbook: pause, key rotation, verifier emergency stop, upgrade procedure, monitoring and alerts.

### C4. Beyond
- Other countries with DKIM-signed receipts (same escrow, new providers); e-signed PDF statements via zkPDF; zkTLS as a third evidence type.
- Merchant checkout SDK and an on-ramp widget; SEP-compatible anchor interface.
- Proof aggregation to cut per-trade cost.

---

## Decisions taken
- **Evidence = per-transaction e-dekont e-mail** (2026-09-08), statement path removed.
- **GPU rental over a fixed host** (2026-09-10/12): 15 s proofs, reproducible from the artifact host, ~$0.36/h only while needed.
- **ICICLE GPU Groth16 wrap over risc0's CUDA wrap** (2026-09-10): the latter crashes on 3.0.x.
- **Market model** (2026-09-10): ads + reservations instead of fixed offers.
- **No Gmail OAuth** (2026-09-12): whitelist-only until CASA verification.
- **.eml drop for the hackathon, inbound address for production** (2026-09-12): a forwarding rule is too much setup for a first-time tester.
- **Payment reference as one token** (2026-09-12): easier to type on a phone, still collision-free.

## Decisions still open
1. Prover hosting model for production: team-hosted TEE vs self-host vs a proving market (affects 8, 14).
2. Second bank (12): by demand, not by ease.
3. Mainnet legal posture (13): the long pole; start the conversation before the code is ready.
