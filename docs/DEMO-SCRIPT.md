# Demo script — 4 minutes (judges)

Current as of 12 September (escrow v5, GPU prover, single-token reference). The live path is: reserve → reveal → FAST →
declare → drop the .eml → proof (~15 s) → claim.

## Pre-stage (the evening before)
| Item | Done when |
|---|---|
| GPU box rented and deployed (`scripts/gpu/deploy.sh "<ssh line>" --test <eml>`), kept through the event | `scripts/check-image-id.sh` prints "all three agree" |
| Two Freighter profiles on testnet, funded (Friendbot): a maker and a buyer | balances visible |
| Five ads live (kaleab, kaloş, peter, ayşe, mehmet); the demo ad's payee is the presenter's own Vakıf IBAN | market page shows them |
| One Ziraat account (the buyer) with ≥ ₺70 (₺50 + ₺8.37 fee), phone on the desk | |
| A **fresh reservation paid one hour before** (declared, .eml already downloaded) as the fallback, plus reservation #7/#8 bookmarked as completed trades | "Recent trades" shows them |
| Web app: https://zkotc.vercel.app loads, `/gpu/info` answers, prover-offline banner absent on a reservation page | |
| Backup video of the full loop (recorded at the rehearsal) | on the laptop |

## Live sequence
| t | Action | Say |
|---|---|---|
| 0:00 | Market page (five ads, recent trades) | "Binance P2P without the platform: makers post liquidity, buyers pay by FAST, a zero-knowledge proof of the bank's own e-mail releases the crypto. No custody, no oracle, no dispute desk." |
| 0:25 | Buyer profile: open the ₺40 ad, type ₺50, Reserve → Freighter | "Reservation holds 1.25 XLM for an hour. No money moved yet." |
| 0:45 | Step 1: Reveal bank details → sign in Freighter | "The maker's IBAN is encrypted on-chain; only the wallet that reserved gets to see it, after a signature. The page checks it against the on-chain commitment." |
| 1:00 | Phone: Ziraat Mobil, FAST ₺50 to the IBAN, açıklama = the reference on screen (`ZKOTC<id><code>`) | "The reference ties the payment to this wallet. Anyone who steals the e-mail later gets nothing." |
| 1:30 | Step 2: "I have sent it — declare on-chain" → Freighter | "From now on the maker cannot pull the liquidity for two hours, and their bond backs the buyer." |
| 1:45 | Phone: the transfer → Dekont Gönder → E-posta. Laptop: Gmail → Show original → Download original | "Ziraat DKIM-signs this e-mail; the receipt is inside the signed body. Forwarding would break the signature." (If the mail is slow: use the fallback reservation's .eml.) |
| 2:15 | Drop the .eml → sign the prove message → progress bar | "Inside the zkVM: RSA-SHA256 DKIM, MIME, the Ziraat receipt, the reference. Out come only hashes, the amount, the date and a nullifier. Groth16 on a rented GPU, about 15 seconds." |
| 2:15–2:45 | While proving: How it works → operator statement; the escrow on stellar.expert | "Honest trust model: users are safe from each other; the operator is still a single admin — timelock and enclave are next." |
| 2:45 | Claim → Freighter → "Crypto released to you" toast | Open the settle tx: verifier router sub-invocation + XLM transfer. |
| 3:15 | Tamper demo: drop `claude_dekont (4).eml` (one edited character) on any reservation | "Dkim(BodyHashMismatch). One byte changed, the bank's signature no longer verifies." |
| 3:40 | Close on the market page | "Adding a bank is a parser and a key hash. The escrow and the verifier stay the same." |

## 30-second pitch
Turkey has instant FAST transfers and banks that e-mail DKIM-signed transfer receipts, but no self-custodial way to buy
crypto with TRY. zkOTC is a P2P market on Stellar where the buyer proves, in zero knowledge, that the bank's own signed
e-mail contains a FAST payment to the maker with a reference naming the buyer's wallet. The proof is verified on-chain by
the RISC Zero verifier router in about 15 seconds. No oracle, no KYC vendor, no custodian.

## Likely questions
| Q | A |
|---|---|
| Who do I trust? | Ziraat's DKIM key (only the bank can sign), RISC Zero, Soroban, and today one operator who can read makers' IBANs and change the accepted program — stated on the site; timelock + attested enclave are the next steps. |
| Can the receipt be faked? | Only with Ziraat's private key. We showed a one-byte edit failing the body hash; the parser reads bank fields only from the bank's block, so nothing typed into the description can impersonate them. |
| RSA-1024? | It is the bank's key; still only the bank can forge, but it is weak by today's standards. We pin the key hash on-chain and can rotate. |
| Replay / double use? | Nullifier per receipt stored forever; date window from the reservation; amount and payee checked; reference bound to the claiming wallet. |
| Why the reference in the description? | A receipt is a document anyone could obtain; the reference makes it useful to exactly one wallet. |
| What if the buyer pays and the maker walks? | After `declare_paid` the maker cannot release for two hours; if they do later, a valid proof within three days takes their bond slice. |
| Other banks / countries? | Any DKIM-signed receipt e-mail: new parser + new trusted key hash. Same escrow, same verifier. |
| Why not fetch the e-mail automatically? | Gmail's read scope needs Google's CASA audit to serve the public; Ziraat only mails the registered address. Production path: an inbound address per wallet with a one-time forwarding rule. |
| Proving cost? | ≈ $0.003 per proof on a rented 4090; 84 minutes on a CPU box, which is why the GPU runbook exists. |
