# Roadmap — from hackathon build to a real TRY on-ramp

Status 2026-09-08: escrow + RISC Zero verifier router live on testnet, guest verifies real Ziraat e-mails,
web app deployed. Not yet done: one real Groth16 receipt through `fulfill`.

## 0. Close the loop (this week, before the hackathon)
| # | Task | Why it is first |
|---|---|---|
| 0.1 | Rent an x86 box (or GPU), `rzup install risc0-groth16`, run `zkotc-server`, produce a **real** receipt for a real Ziraat e-mail and submit `fulfill` on testnet | The only untested link: claim digest ↔ Nethermind verifier ↔ escrow. Measure CPU cost of `fulfill`. |
| 0.2 | Two Ziraat accounts, a real ₺50 FAST, full UI flow with Freighter on both sides | Finds UX gaps no unit test can. |
| 0.3 | Pin `image_id` in the repo (`prover/IMAGE_ID`) + CI check; GitHub Actions for lib/contract tests, clippy, wasm + guest build, web lint/build | Guest changes silently invalidate the escrow config. |
| 0.4 | Prover hardening: persistent job store (SQLite/Postgres), worker queue, auth token + rate limit on `POST /jobs`, metrics | Today jobs live in memory in one process. |

## 1. Trust & safety (weeks 2–6)
| # | Task |
|---|---|
| 1.1 | **Close the trust gap**: on-chain `declare_paid(id)` by the buyer freezes `unlock`/`cancel` for a proof window (e.g. 45 min); seller bond slashed if they withdraw against a valid late proof; dispute log via events. |
| 1.2 | **DKIM key registry** contract: `(domain_hash → [key_hash, valid_from, valid_to])`, admin via timelock/multisig, daily monitor of `msg2._domainkey.ileti.ziraatbank.com.tr` (and future banks). |
| 1.3 | **Prover privacy**: run `zkotc-server` inside a TEE (AWS Nitro or SGX, which you already work with) with remote attestation shown in the UI; publish a Docker image so buyers can self-host. Boundless is not private — use it only for users who opt in. |
| 1.4 | **DKIM verifier assurance**: fuzz + differential tests against dkimpy over a corpus (RFC 6376 vectors, folded headers, `l=`, multiple signatures, relaxed/relaxed). Property tests for the statement parser. |
| 1.5 | Escrow review: reentrancy-free token flows, TTL/archival handling for old offers, event schema freeze, admin multisig. External audit before mainnet. |

## 2. Product (months 2–4)
| # | Task |
|---|---|
| 2.1 | **Gmail OAuth** (`gmail.readonly`, `messages.get?format=raw`) to fetch the statement `.eml` automatically; IMAP fallback. Removes the "Show original → Download" step. |
| 2.2 | **Bank providers**: abstraction in `zkotc-lib` (`domain`, `parse`, `nullifier`), guest commits a provider id, escrow allow-list per provider. Add İş Bankası, Garanti, Yapı Kredi, Akbank (each: DKIM domain/key + parser + test e-mails). |
| 2.3 | **Seller privacy**: keep only `iban_hash` on-chain; reveal IBAN/name to the locked buyer through the API after SEP-10 auth. |
| 2.4 | **Market features**: partial fills, price in bps vs an XLM/USDC↔TRY reference, maker fees, reputation from fulfilled/cancelled counts, limits per wallet. |
| 2.5 | **Onboarding**: sponsored trustlines/reserves for USDC, wallet kit on mobile, Turkish UI. |
| 2.6 | **Indexer + notifications**: Soroban events → Postgres (own RPC poller or Mercury), activity pages, Telegram/e-mail alerts for lock/expiry/fulfil. |

## 3. Mainnet (months 4–6)
| # | Task |
|---|---|
| 3.1 | Verifier router on mainnet (Nethermind's or own deployment, 7-day timelock), escrow audit, USDC mainnet, treasury. |
| 3.2 | **Legal review (Türkiye)**: Law 7518 crypto-asset service provider regime (SPK), MASAK AML obligations for P2P platforms; document the non-custodial model and decide on limits/KYC-lite. Do not launch mainnet without this. |
| 3.3 | Economics: who pays proving (Boundless/GPU cost per proof), fee split, gas sponsorship. |
| 3.4 | Incident playbook: pause, key rotation, verifier emergency stop, upgrade procedure. |

## 4. Beyond (6 months+)
- Other countries with DKIM-signed statements (same escrow, new providers); e-signed PDF statements (İş Bankası) via zkPDF as a second evidence type; zkTLS as a third.
- Merchant checkout SDK (pay TRY, settle on Stellar) and an on-ramp widget for wallets; SEP-compatible anchor interface.
- Proof aggregation / batching to cut per-trade proving cost.

## Decisions to make early
1. Prover hosting model: team-hosted TEE vs self-host vs Boundless (affects 1.3, 2.1, 3.3).
2. Bank coverage order (2.2) — pick the second bank by user demand, not by ease.
3. Mainnet legal posture (3.2) — start the conversation now; it is the long pole.
