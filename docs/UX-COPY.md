# UX copy — zkOTC (v1, testnet)

Voice: plain, specific, no crypto jargon where a bank word exists. English primary; Turkish only for the exact strings the user sees in Ziraat.

## Navigation
| Item | Copy |
|---|---|
| Brand | zkOTC · `testnet` pill |
| Nav | Offers · Sell crypto · My activity · How it works |
| Wallet button | Connect wallet → `G…XXXX` (click: disconnect) |

## Home
| Element | Copy |
|---|---|
| H1 | Buy XLM or USDC with a Turkish bank transfer. No middleman. |
| Sub | Sellers escrow crypto on Stellar. You pay them in TRY with a normal FAST transfer, then prove the payment from Ziraat's own e-dekont e-mail with a zero-knowledge proof. The escrow releases automatically. |
| Trust box | • Funds sit in a Soroban escrow contract, never with us. • Evidence is the bank's DKIM-signed e-mail, verified inside the RISC Zero zkVM. • The Groth16 proof is checked on-chain with native BN254 pairing. |
| Filter | Available · All |
| Empty | No offers yet — Be the first: create an offer. |
| Card | `100 USDC` / `You pay by FAST ₺4.000,00` / `≈ 40,00 ₺ / USDC` / status pill |

## Status pills
| On-chain | Pill | Note |
|---|---|---|
| Open | Open | green |
| Locked | Reserved | amber; `· timer ended` suffix when lock_expires_at passed |
| Fulfilled | Completed | accent |
| Cancelled | Cancelled | grey |

## Sell crypto (create offer)
- Title: **Sell crypto for TRY**. Sub: Your tokens are locked in the escrow contract until a buyer proves a FAST transfer to your IBAN. You can withdraw any time while nobody has reserved the offer.
- Fields: Token · Amount (deposited into escrow now) · Price in TRY (buyer sends exactly this; range hint from contract) · Your IBAN (any Turkish bank; stored on-chain in plain text; TR + 24 digits) · Account holder name (exactly as your bank shows it — FAST requires the recipient name) · Offer expires after (days).
- Consent: I understand my IBAN and name will be publicly visible on Stellar testnet, and that the escrow releases automatically when a buyer proves a payment of at least the TRY amount to this IBAN. Protocol fee: 0.25% of the token amount.
- CTA: **Deposit 100 USDC and publish offer** / Connect wallet to continue.

## Offer page — buyer, Open
- H2: Buy this offer. Steps: 1) Reserve the offer (a Stellar transaction, no funds move). You get 60 minutes. 2) Send exactly ₺X by FAST from your **Ziraat** account to the seller's IBAN. 3) Have Ziraat e-mail you the transfer's dekont, upload the .eml here, and claim N TOKEN.
- CTA: **Reserve offer**. Footnote: You must pay from a Ziraat Bankası TRY account: the proof is built from Ziraat's DKIM-signed e-dekont e-mail for the transfer. Fee 0.25% is deducted from the crypto you receive.

## Offer page — buyer, Reserved by me (stepper: Pay by FAST → Get e-dekont e-mail → Generate proof → Claim crypto)
| Step | Copy |
|---|---|
| 1 | **Send the bank transfer** — Alıcı IBAN · Alıcı adı · Tutar · Transfer type: FAST (instant) from your Ziraat TRY account. Checkbox: I have sent exactly ₺X to this IBAN. |
| 1 guard (< 15 min left) | Less than 15 minutes remain on your reservation. Do **not** send money now: release the reservation and reserve again to get a fresh timer. |
| 2 | **Get the e-dekont e-mail for this transfer** — Ziraat Mobil / İnternet Şubesi → **Hesap Hareketleri** → open the FAST you sent → **Dekont Gönder** → **E-posta** (subject `e-dekont`, arrives within ~2 min). In Gmail: ⋮ → **Show original** → **Download original** (.eml). Do not forward it; forwarding breaks the signature. |
| 3 | **Generate the zero-knowledge proof** — file input (.eml). Consent: I understand the e-mail (the dekont of this one transfer) is sent to the prover at <url> (mode, DKIM key source), kept only in memory while the proof is generated, and that only hashes, the amount, the date and a nullifier go on-chain. CTA: Verify e-mail and start proving. |
| 3 progress | Queued — Waiting for the prover. · Checking e-mail — DKIM signature, e-dekont attachment and transfer details are verified. · Generating proof — RISC Zero zkVM run → Groth16 proof over BN254 (2–10 min). · Proof ready — Submit it to the escrow contract to receive your crypto. Row line: Dekont: 07.09.2026 18:21:03 · F05247 · ₺4.000,00 · <masked description>. |
| 4 | **Claim your crypto** — The proof (356 bytes) will be verified by the Soroban verifier contract inside the same transaction that pays you. CTA: Claim 99.75 USDC. |
| Timer ended banner | Your reservation timer ended. You can still claim as long as nobody releases the reservation, so finish the proof now. |
| Footer | Changed your mind and have **not** paid? Release the reservation. |

## Offer page — reserved by someone else / seller
- Reserved by G…XXXX since <date>. Wait for the timer to end to reserve it yourself.
- Timer ended: The reservation timer has ended, but the buyer may already have sent the bank transfer and be generating their proof. Releasing lets someone else reserve. (seller: Check your bank account before withdrawing.) Buttons: Release reservation · Withdraw funds anyway (danger).
- Seller, Open: Your offer — Nobody has reserved it. You can withdraw your USDC any time. CTA: Withdraw 100 USDC.
- Completed: Completed on <date>: 99.75 USDC went to G…XXXX. Cancelled: The seller withdrew this offer.

## Error messages (contract error → user text)
| Code | Name | User text |
|---|---|---|
| 2 | Paused | The marketplace is paused by the operator. Existing reservations can still be settled. |
| 3 | OfferNotFound | This offer does not exist. |
| 4 | InvalidStatus | This offer is not in a state that allows this action. |
| 6 | NotBuyer | Only the wallet that reserved this offer can claim it. |
| 7 | LockActive | Another buyer holds this offer right now. Try again when the timer runs out. |
| 9 | OfferExpired | This offer has expired. The seller can withdraw it. |
| 10 | TokenNotAllowed | This token is not on the allow-list. |
| 11 | InvalidPublicValues | The proof output is malformed. Regenerate the proof. |
| 12 | DkimKeyNotTrusted | The e-mail was signed with a DKIM key this contract does not trust yet. |
| 13 | DomainMismatch | The e-mail was not signed by ileti.ziraatbank.com.tr. |
| 14 | PayeeMismatch | The dekont's recipient (name, bank, account) does not match the seller. |
| 15 | AmountTooLow | The transfer in the dekont is smaller than the offer amount. |
| 16 | DateOutOfWindow | The payment date is before you reserved this offer (Istanbul calendar day). |
| 17 | NullifierUsed | This bank transfer was already used to settle another offer. |
| 18 | ProofInvalid | The zero-knowledge proof did not verify on-chain. |
| 19 | WrongOffer | This proof was generated for a different offer. |
| 20 | InvalidAmount | Enter an amount greater than zero. |
| 21 | InvalidIban | IBAN must be a Turkish IBAN: TR + 24 digits. |
| 26 | InvalidName | Enter the account holder name (1–64 characters). |
| 22 | AmountOutOfRange | The TRY amount is outside the allowed range for this testnet deployment. |
| 23 | InvalidExpiry | Expiry must be in the future. |
| 25 | InvalidFee | Fee above the 1% cap. |
| wallet | — | Insufficient balance for this transaction (including network fee). / Missing trustline: add the asset to your wallet first. |

## Prover errors (HTTP 400 text shown verbatim under the upload)
- `dkim key: …` → We could not fetch the bank's DKIM key.
- `this dekont is an incoming transfer` → Upload the dekont of the transfer you *sent*, not one you received.
- `the dekont's recipient IBAN does not match the seller's IBAN` / `does not show a recipient IBAN` → Wrong transfer, or a dekont type without the payee IBAN.
- `transfer of X kuruş is below the offer amount` / `transfer dated D is before the reservation day` → Amount or date rule failed.
- `verification failed: Dkim(BodyHashMismatch)` → The e-mail was modified after Ziraat sent it (forwarded or edited). Download the original .eml again.
- `verification failed: Dkim(SignatureInvalid)` → The signature does not match Ziraat's key.
- `verification failed: FromDomainMismatch` → The e-mail is not from Ziraat.
