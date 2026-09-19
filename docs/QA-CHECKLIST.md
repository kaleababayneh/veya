# QA checklist — testnet, "production-ready on testnet" definition of done

## Definition of done
- [ ] Verifier + escrow deployed on testnet from tagged source; ids in `contracts/DEPLOYMENTS.md`, web `.env`.
- [ ] Escrow `config()` shows the real RISC Zero image id (`zkotc image-id`) and Ziraat msg2 DKIM key hash.
- [ ] One real end-to-end fulfil tx on testnet with a real Groth16 proof (not mock) linked in README.
- [ ] `cargo test` green in `contracts/` (24 tests) and `prover/lib` (6 tests incl. real e-mail).
- [ ] Web app builds (`next build`) with zero type errors and is deployed (Vercel) with the prover URL set.
- [ ] Prover `/info` reports `prover_mode` ≠ `mock` in the deployed environment.

## Happy path
| # | Step | Expect |
|---|---|---|
| H1 | Seller creates 2 USDC / ₺50 offer | escrow balance +2 USDC, offer Open, card visible ≤ 15 s |
| H2 | Buyer reserves | Reserved, countdown 60:00, IBAN/name/amount shown |
| H3 | Buyer pays ₺50 by FAST, gets .eml, uploads | job: queued → executing → proving → done; matched row shown |
| H4 | Claim | tx success; buyer +1.995 USDC, treasury +0.005 USDC; status Completed |

## Failure paths (contract)
| # | Case | Expect |
|---|---|---|
| F1 | Second wallet reserves a Reserved offer | LockActive |
| F2 | Seller cancels during active lock | LockActive |
| F3 | Buyer claims with proof for another offer | WrongOffer |
| F4 | Statement row to other IBAN | IbanMismatch (prover refuses earlier: no matching row) |
| F5 | Row amount < offer | AmountTooLow (prover refuses earlier) |
| F6 | Row dated before reservation day | DateOutOfWindow |
| F7 | Same .eml row on a second offer | NullifierUsed |
| F8 | Tampered proof byte | ProofInvalid |
| F9 | Admin pauses | create/lock → Paused; fulfil/unlock/cancel still work |

## Failure paths (prover)
| # | Case | Expect |
|---|---|---|
| P1 | Forwarded e-mail | 400 `Dkim(BodyHashMismatch)` |
| P2 | Non-Ziraat e-mail | 400 `Dkim(NoSignature)` or `FromDomainMismatch` |
| P3 | Edited attachment | 400 `Dkim(BodyHashMismatch)` |
| P4 | Statement without matching row | 400 "no outgoing transfer …" |
| P5 | > 2 MiB file | 400 "e-mail larger than 2 MiB" |
| P6 | Prover down | UI shows fetch error, reservation unaffected |

## Wallet / network edge cases
| # | Case | Expect |
|---|---|---|
| W1 | Freighter on mainnet | signTransaction rejects (network mismatch) → clear error |
| W2 | Buyer has no USDC trustline | fulfil simulation fails "trustline" → UI: add asset first |
| W3 | < 1 XLM for fees | "Insufficient balance" |
| W4 | Page reload mid-proof | job id restored from localStorage, polling resumes |
| W5 | Two tabs | second claim → InvalidStatus |

## Ops
- [ ] DKIM key monitor: `dig TXT msg2._domainkey.ileti.ziraatbank.com.tr` daily; on change → `set_dkim_keys([old, new])`.
- [ ] Prover logs contain no e-mail bodies; jobs map pruned after 1 h.
- [ ] Rate limit / auth on `POST /jobs` before any public URL.
