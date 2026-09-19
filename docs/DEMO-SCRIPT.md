# Demo script — 4 minutes (judges)

## Pre-stage (the night before)
| Item | Done when |
|---|---|
| Two Freighter wallets on testnet, funded (friendbot), USDC trustline on both | balances visible |
| Seller wallet holds ≥ 100 USDC (Circle testnet faucet) | |
| One Ziraat account (buyer) with ≥ ₺60; seller IBAN (teammate) known | |
| A **completed** offer already on-chain (backup) with its fulfill tx hash bookmarked | explorer tab open |
| Prover server running (x86 box or Succinct network), `GET /info` returns mode ≠ mock | curl ok |
| Web app deployed, `NEXT_PUBLIC_*` pointing at the deployed contracts | loads offers |
| A fresh Ziraat statement `.eml` from **today** containing the live FAST row (in case live e-mail is slow) | file on desktop |

## Live sequence
| t | Action | Say |
|---|---|---|
| 0:00 | Home page | "P2P TRY on-ramp on Stellar. No custodian, no oracle: the bank's own signed e-mail is the evidence." |
| 0:20 | Seller: Sell crypto → 2 USDC for ₺50 → confirm in Freighter | "USDC is now in the Soroban escrow." Show tx in explorer. |
| 0:50 | Buyer (second browser profile): Reserve offer | "60-minute exclusive lock; no funds move." |
| 1:05 | Phone: Ziraat app, FAST ₺50 to seller IBAN (pre-filled contact) | "Instant, 24/7, every Turkish bank." |
| 1:30 | Ziraat app: Hesap Hareketleri → E-posta Gönder; Gmail → Show original → Download | "Ziraat DKIM-signs this e-mail; the statement is inside the signed body." (If slow: use the pre-downloaded .eml.) |
| 2:00 | Upload .eml → job goes queued → checking → proving | "RISC Zero verifies RSA-SHA256 DKIM, decodes the attachment, parses the row, commits only hashes + amount + date + nullifier." |
| 2:00–3:20 | While proving: show `/how-it-works`, the verifier contract on explorer, the verifier router on the explorer | "Groth16 over BN254 verified natively on Soroban since Protocol 25." |
| 3:20 | Claim → Freighter → success | Open fulfill tx: verifier sub-invocation + USDC transfer events. |
| 3:50 | Close | "Generalizes to any bank that DKIM-signs statements; adding one is a parser + a key hash." |

## 30-second pitch
Turkey has instant FAST transfers and banks that e-mail DKIM-signed statements, but no self-custodial way to buy crypto with TRY. zkOTC escrows XLM/USDC on Soroban and releases it when the buyer proves, in zero knowledge, that the bank's own signed e-mail contains a FAST payment to the seller. The proof is verified on-chain with Stellar's native BN254 pairing. No oracle, no KYC vendor, no custodian.

## Likely questions
| Q | A |
|---|---|
| Who do I trust? | Ziraat's DKIM key (only the bank can sign), the RISC Zero proving system, Soroban. The prover sees your statement but cannot forge a proof; run your own or use the network's TEE mode. |
| Why Stellar? | FAST-like settlement, USDC native, and Protocol 25/26 shipped BN254 host functions so a Groth16 verify is a single native pairing check (limit 100M CPU). |
| RSA-1024? | It is the bank's choice; only the bank can forge. We pin the key hash on-chain and can rotate it. |
| Replay / double spend? | Nullifier per statement row stored forever; date window ≥ reservation day; proof bound to offer id; only the locking wallet can claim. |
| Other banks / countries? | Any DKIM-signed statement or receipt e-mail: new parser + new trusted key hash. Same escrow, same verifier. |
| What if the buyer pays but the timer ends? | Claim still works until someone releases the lock; UI warns sellers before releasing; v2 adds a seller bond. |
