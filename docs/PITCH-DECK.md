# zkOTC — pitch deck content (official template + 4 added slides)

The official template (make your own copy: https://docs.google.com/presentation/d/1oRWx77PH3WsQ67Is9Xhg3GVNmkwVO7lU4Ab241__ahE)
has five slides: **Cover · PMF (the problem) · The Solution · Technical Workflow · The Team**. Keep those five in that order
and insert the four extra ones marked **[added]** where shown. Budget: 4 minutes, ~25 s per slide, the demo gets the rest.
Text in *italics* is the on-slide copy; "Say" is what you speak; "Show" is the visual to paste.

---

## 1 · Cover (template)

*zkOTC (Veya) — a peer-to-peer TRY → XLM/USDC market on Stellar, settled by a zero-knowledge proof of your bank transfer.*
*Kaleab Abayneh · Genesis Track · veya.lol · github.com/kaleababayneh/veya*

Show: the market page screenshot (five ads, "Recent trades" with the three settled trades).
Say: "Buy crypto with Turkish lira the way you pay anyone: a FAST transfer. No exchange, no custodian, no dispute desk."

## 2 · PMF — the problem (template)

*Turkey: instant, free bank transfers (FAST) between every bank, and one of the world's highest crypto adoption rates.*
*Yet buying crypto with lira means either a centralised exchange with custody and KYC, or a P2P desk built on trust:
screenshots as "proof", frozen escrows, human dispute desks. Binance P2P alone handles this daily for Turkish users,
and every trade rests on a moderator believing a screenshot.*

Show: a Binance P2P dispute screenshot or a simple "screenshot → trust" icon.
Say: "The rail exists. What is missing is evidence that a lira payment happened that a contract can check by itself."

## 3 · The Solution (template)

*The bank already signs a receipt: every FAST transfer produces a DKIM-signed e-mail from Ziraat or VakıfBank.*
*zkOTC turns that e-mail into a zero-knowledge proof and lets a Soroban escrow release the crypto on it.*
- *Makers escrow XLM/USDC and post a price; their IBAN is encrypted on-chain.*
- *A buyer reserves, pays the maker by FAST with a reference naming their wallet, and drops the bank's e-mail.*
- *A RISC Zero proof (15 s on a GPU) is verified on Stellar; the escrow pays the buyer.*
*No custodian, no oracle, no KYC vendor, no screenshots. Two banks live. Real lira in, real XLM/USDC out, on testnet today.*

Show: the reservation page at step 3 with "✓ Verified" and the transfer card.
Say: "Nobody trusts anybody here. The bank's own RSA signature is the evidence, checked inside a zkVM, verified on-chain."

## 4 · Live demo [added]

*Reserve → reveal → pay by FAST → declare → drop the e-mail → 15 s → claim.*

Show: live, from a reservation paid an hour earlier with the `.eml` on the desktop (`docs/DEMO-SCRIPT.md`); backup video if
the network fails.
Say: while the progress bar runs: "Inside the zkVM: the RSA signature, the MIME body, the bank's receipt, the amount, the
IBAN, the reference. Out come only hashes, an amount, a date and a nullifier."

## 5 · Technical Workflow (template)

Show: the architecture diagram from `docs/TECHNICAL-DESIGN.md` (screenshot of the rendered Mermaid).
*Browser + Freighter → Soroban escrow (ads, reservations, bonds) → bank receipt e-mail → RISC Zero guest (DKIM · MIME ·
receipt parser) on a rented RTX 4090 → 260-byte Groth16 seal + 184-byte journal → Nethermind's RISC Zero verifier router →
escrow settles.*
*Journal: DKIM key hash · bank domain hash · payee hash · amount · date · nullifier · reservation id · reference hash.*

Say: "The escrow checks every field of that journal: the right bank key, the maker's committed IBAN, at least the reserved
amount, the reservation's day, a fresh nullifier, and a reference derived from the claiming wallet, so a stolen e-mail is
useless to anyone else."

## 6 · Why it cannot be gamed [added]

- *One edited byte in the e-mail → `Dkim(BodyHashMismatch)` (we show this live).*
- *A receipt for another wallet → `ReferenceMismatch`; reused receipt → `NullifierUsed`; incoming transfer dressed up as outgoing → refused by three independent anchors in the parser.*
- *Text a payer types into the description is parsed as hostile: bank fields are read only from the bank's own block.*
- *What we don't hide: the operator holds the reveal key and the admin key today. Timelock + attested enclave are the next two items.*

Show: the tampered-file rejection message; the "what the operator can and cannot do" box from How it works.
Say: "Users are safe from each other and from the counterparty. We tell them exactly what they still trust us with."

## 7 · Integrations and the anchor [added]

- *Stellar Wallets Kit — every signature in the app.*
- *RISC Zero verifier router (Nethermind) — every settlement.*
- *Circle USDC — supported market asset.*
- *TR anchor (SEP-1/10/6/38 client) — the licensed rail makers use to refill USDC inventory and cash out; its oracle rate is the price our makers undercut (a USDC ad on the board was funded through it).*
- *SEP-1 `stellar.toml` published; SEP-53 wallet-signed messages for the reveal and prove APIs.*

Show: the Anchor page (maker-facing) and a USDC ad row with "1.9 % below anchor".
Say: "Two doors to the same balance: the licensed door with KYC and a spread, and the peer door that beats it on price and
privacy because the proof replaces trust."

## 8 · Traction and what it took [added]

*3 real trades settled on testnet (₺50, ₺58 by Ziraat; ₺50 by VakıfBank), 7 ads, 11 reservations, 2 banks.*
*Built from 7 September: 84 min → 15 s per proof; two receipt formats (HTML and PDF) verified in the zkVM; a Gmail quirk that
breaks every VakıfBank receipt found and handled; 48 automated tests; CI; one-command GPU deployment.*
*Onboarded at the venue: __ users, __ trades (fill in on the 20th).*

Show: stellar.expert settle transaction; the "Recent trades" cards.
Say: "Everything you saw is on testnet with real bank transfers behind it. Anyone here with a Ziraat or VakıfBank account can
do a trade in three minutes."

## 9 · Roadmap [added]

*Next 4 weeks: timelock on admin actions, reproducible guest build, reveal key in an SGX enclave, DKIM key registry.*
*Then: inbound e-mail address (no .eml step), USDC off-ramp via the P2P reverse proof, more banks (each is a parser + a key
hash), price pegging, indexer, legal review for Türkiye, mainnet behind an audit.*

Show: three columns, weeks / months / mainnet.
Say: "The cryptography is done. What's left is the layer that makes it a product people rely on, and every item is listed."

## 10 · The Team (template)

*Kaleab Abayneh — builds the whole stack: Rust zkVM guest and DKIM/MIME/PDF parsers, Soroban escrow, RISC Zero + CUDA proving
ops, Next.js app. Background in SGX/TEE work and zero-knowledge systems; a Ziraat and VakıfBank customer in Istanbul, which is
how the real receipts were obtained.*

Show: a photo.
Say: "I bank with both banks in the demo. Every receipt in this deck is one I paid for."

---

### Speaker timeline (4:00)
0:00 cover · 0:20 problem · 0:45 solution · 1:10 demo starts (reserve, reveal, pay already done; drop the .eml) · 1:40 workflow
while proving · 2:10 claim → settle tx · 2:30 why it cannot be gamed + tamper demo · 3:00 integrations/anchor · 3:25 traction ·
3:45 roadmap + team · 4:00 stop.

### Assets to prepare
- Screenshots: market page, reservation step 3 (verified + transfer card), proving progress bar, settled trade with tx link,
  tamper rejection, Anchor page, USDC ad row, How-it-works operator box.
- Architecture diagram PNG (screenshot of the Mermaid render on GitHub).
- Backup video of the full loop (2–3 min), and the tamper demo (20 s).
- Numbers for slide 8 refreshed on the morning of the 20th.
