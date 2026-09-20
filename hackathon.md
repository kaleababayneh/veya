# Winning the Genesis Track — Stellar Pro Hackathon, Istanbul, 19–20 September 2026

Source: *Pro Hackathon 2026 Tracks & Handbook* (Rise In × Stellar, 10 Aug 2026). Everything in §1 is quoted or paraphrased
from it; §2 onward is our plan. **The detailed judging criteria are still "to be announced"** — update §1.4 the moment they land.

## 1. What the handbook says

### 1.1 Track, dates, prize
- Genesis Track: open application, teams of up to 4, "a net-new product, built from scratch and shipped with a real Stellar
  integration", built **from 1 September until the day of the hackathon**. Prize pool $7,500: **$3,000 / $2,000 / $1,500 / $1,000**.
- Venue Grand Pera, Beyoğlu. Day 1 (19 Sep): registration 09:00, kick-off 10:00, judging overview 10:15, three workshops
  (agentic payments, SCF overview, anchor integration), idea validation + office hours, hacking. Day 2: hacking, submission,
  finalist selection, jury presentations. **Only finalists present live.**
- Submission through a judging portal (URL TBD) before the deadline: team name + members + contacts, all project links
  (GitHub, live demo, deployment URL), pitch-deck link, track selection. *"You will only be evaluated for the tracks you select."*

### 1.2 The three requirements (same for both tracks)
1. **Integration** — build on an existing Stellar protocol from the eligible list (or anything on the full SCF Integration List).
   Listed: DeFindex, Blend v2, Aquarius, Soroswap, Stellar Broker, Circle CCTP, Near Intents, Allbridge, **Stellar Wallets Kit**,
   Privy, DFNS, Bridge, BlindPay. Resources also point at Reflector (oracle), Nethermind's private payments (zk), Circle USDC faucet.
2. **Anchor / Local Payments** — *"give the product a real fiat rail using an anchor or another anchor from the list. Concretely:
   a user should be able to put real Turkish lira in and get a usable balance out, or the reverse."*
3. **Core Feature** — *"the integration is load-bearing, part of what the product does."*

Metrics the organisers track at the end: **teams that shipped a core-feature integration, teams that shipped an anchor
integration, teams that captured real traction, teams that onboarded real users.**

### 1.3 Deliverables ("General Requirements")
- **The narrative "why"**: what, what it fixes, for whom, why it matters, value proposition.
- **MVP = the code**: public GitHub with a well-defined README, documented contracts, links to deployed artifacts, front-end,
  working demo. Soroban SDK, contracts on testnet.
- **Technical docs**: how it fits together, main components, design decisions, trade-offs, challenges overcome.
- **Pitch deck** from the official template (make a copy; add slides if needed):
  https://docs.google.com/presentation/d/1oRWx77PH3WsQ67Is9Xhg3GVNmkwVO7lU4Ab241__ahE
- **Skill citation**: *"teams should cite which specific skill file(s) (by path, e.g. skills/standards/SKILL.md) they used."*

### 1.4 Judging criteria
*"Will be announced soon…"* — projects are scored on the official criteria after the deadline, finalists announced, finalists
present. Until published, assume the usual axes: requirement compliance, technical depth, working demo, UX, traction/users,
narrative, presentation. → **Fill this in when the criteria are released and re-check every item in §2.**

## 2. Where zkOTC stands against the rubric

| Requirement | Evidence today | Gap |
|---|---|---|
| Net-new, built from 1 Sep | First commit 7 Sep 2026; public repo; every day's work in git | none |
| Integration (eligible protocol) | **Stellar Wallets Kit** (listed) is the only way users sign; **Nethermind RISC Zero verifier router** (Stellar zk infra) verifies every settlement on-chain; **Circle USDC** (testnet SAC) is a supported token | add one *DeFi* integration judges recognise from the table: **Reflector oracle price peg** for ads (see §3.2); post a **USDC ad** so the Circle path is exercised |
| Anchor / local payments | Two rails. (a) The peer rail *is* a TRY rail: real ₺50/₺58 FAST transfers on 12 Sep produced real XLM on testnet (reservations #7, #8, #11), from Ziraat and VakıfBank, evidence = the bank's DKIM-signed receipt. (b) **Anchor integration done 13 Sep**: zkOTC is a SEP client of DevRel's TR mock anchor (`tr-mock-anchor.fly.dev`: SEP-1 discovery, SEP-10 wallet login, SEP-6 deposit/withdraw, SEP-38 quotes); makers fund USDC inventory and cash out through it, and its rate is the "price to beat" on the market. A USDC ad (merve, ₺47.90, 1.9 % under the anchor) was funded through the anchor. SEP-1 `stellar.toml` published | Tell the story as one product (§3.3): the anchor is the licensed rail makers use; the peer rail is what buyers use and what wins on price and privacy |
| Core feature / load-bearing | Without the verifier router no trade settles; without the wallet kit nothing signs | none |
| Real traction / real users | 3 settled trades (2 Ziraat-paid, 1 VakıfBank-paid), 6 ads, 11 reservations, all by the team | **onboard strangers**: every Ziraat/Vakıf customer in the room can complete a trade in 3 minutes (§3.4) |
| README, documented contracts, deployed artifacts, demo | README rewritten 12 Sep; `contracts/DEPLOYMENTS.md`; live at zkotc.vercel.app; escrow + verifier on testnet; **`docs/TECHNICAL-DESIGN.md` with the architecture diagram (13 Sep)** | a **demo video** |
| Pitch deck (template) | content written 13 Sep: `docs/PITCH-DECK.md` — the template's five slides plus four added, on-slide copy, speaker notes, asset list, 4:00 timeline | paste into your copy of the Google Slides template; take the screenshots; record the backup video |
| Skill citation | none used explicitly | use and cite `skills/standards/SKILL.md` (SEP-53 signed messages, SEP-1) and the Anchors skill (§3.7) |

## 3. Plan

### 3.1 Calendar
| When | What |
|---|---|
| Sat 13 Sep | ~~Anchor integration~~ done (SEP-1/10/6/38 client, maker-facing, price-to-beat on the market, USDC ad funded via the anchor). Next: technical design doc + diagram; Reflector peg now optional (the anchor's SEP-38 rate already comes from Reflector) |
| Sun 14 Sep | `claim_bond` real test, SEP-1 `stellar.toml`, skill citations, QA pass (`docs/QA-CHECKLIST.md`) — first Vakıf-paid trade already done 12 Sep (#11) |
| Mon 15 Sep | `reclaim_bond` on #1 (window ends 20:09), pitch deck v1, demo video recorded |
| Tue 16 Sep | **Code freeze on the guest** (image id stable), README final, rehearsal #1 |
| Wed 17 Sep | Buffer; rehearsal #2 with a fresh reservation; print the QR card |
| Thu 18 Sep | Rent the demo GPU box in the evening, `deploy.sh`, three-way image-id check; keep it through the 20th |
| Fri 19 Sep | Register 09:00; attend the anchor workshop (13:00) and quote it in the pitch; mentor validation; **onboard users all day** |
| Sat 20 Sep | Submit early (portal), keep onboarding, finalist presentation (4 min, `docs/DEMO-SCRIPT.md`) |

### 3.2 Integration: Reflector price peg (the one thing to build)
Makers today set a fixed ₺ price. Add an optional peg: `price = Reflector XLM/USD (or USDC/USD) × USD/TRY × (1 + spread)`,
read on-chain at `reserve` time so the quote is live. Why this one: it is on the organisers' resource list, it is a Soroban
contract call from our escrow (load-bearing: it sets the price of every pegged trade), it removes the "who updates the
price?" question from the demo, and it is a day of work: escrow `Ad.peg: Option<(feed, spread_bps)>`, a `quote` that reads
the feed, a "peg to market" toggle on Post an ad, and a market column "market +1.5 %". Fallback if Reflector's testnet feed
is flaky: keep fixed prices, ship the peg behind a flag, and mention it as roadmap.

### 3.3 Anchor / local payments: the argument
We now have both: the peer rail and a real SEP anchor integration. Say it as one product: *"Turkish users get two doors to the same balance. The licensed door is the anchor (SEP-6, KYC, a spread over the oracle rate); makers use it to refill inventory and cash out. The peer door is ours: pay a maker by FAST, prove the bank's own signed receipt in zero knowledge, no KYC, no custody, and a price that beats the anchor because makers compete with its rate on our board."* Then the older one-breath version, still true: *"Turkey has instant, free FAST transfers between every bank. We use them
as the fiat rail directly: the buyer pays the seller by FAST, and the bank's own DKIM-signed receipt e-mail, verified inside a
zkVM, releases the escrow. Real lira in, real XLM/USDC out, no anchor holding money, no KYC vendor, no chargeback risk. It is the
P2P rail Binance runs for Turkish users, without Binance."* Then show the two settled trades on stellar.expert and do a live one.
If a judge insists on an anchor: an anchor is the *centralised* version of this rail; our roadmap lists a SEP-24 wrapper so
wallets can drive zkOTC as an anchor. Adding a `stellar.toml` (SEP-1) with the contract addresses and a `DOCUMENTATION` block
costs 20 minutes and makes the deployment discoverable like any anchor.

### 3.4 Traction: onboard real users at the venue
The metric is explicit. Everyone in the room with a Ziraat or VakıfBank account can trade in three minutes:
- A printed **QR card**: "Buy 1 XLM for ₺40 with your Ziraat/Vakıf app, get it in 60 seconds" → zkotc.vercel.app.
- **Minimum trade ₺20** on a dedicated "hackathon" ad (needs a `set_config --min_try_kurus 2000`), so nobody hesitates.
- Fund testnet wallets for them on the spot (Friendbot link is on the site); Freighter install is the slowest step — have a
  laptop with it ready, or prepare the passkey smart-wallet path later.
- The maker's IBAN is ours; each trade costs the tester ₺20 + ₺8.37 bank fee that lands in our account (offer to refund cash).
- A live **"Recent trades"** wall on the market page already shows every settlement. Count them; put the number on the last slide.
- Vakıf users: pick "VakıfBank" in step 3; Gmail on a laptop for the .eml (phones cannot export it — say it upfront).

### 3.5 Technical docs and diagram
Write `docs/TECHNICAL-DESIGN.md` (from the README, `docs/RESEARCH-NOTES.md`, `docs/GPU.md`): components (web, `/api/prove`
and `/api/reveal`, prover box, RISC Zero guest, escrow, verifier router), the data flow of one trade, the journal layout, the
trust model (what the operator can and cannot do), design decisions and trade-offs (why zkEmail over screenshots/zkTLS, why
RISC Zero, why a GPU rental, why the payment reference, why sealed IBANs, why .eml over Gmail OAuth), challenges overcome
(84 min → 15 s, the CUDA Groth16 crash, Ziraat's typed-açıklama layout, Gmail rewriting Vakıf's Message-ID). One Mermaid
architecture diagram at the top; export it as PNG for the deck.

### 3.6 Pitch deck (official template, ~10 slides, 4 minutes)
1. Title + one line. 2. Problem: no self-custodial way to buy crypto with TRY; P2P today = trust + disputes.
3. The rail: FAST + the bank's signed receipt (local payments slide). 4. How it works (diagram). 5. Live demo (or video).
6. What is verified on-chain (journal, verifier router, 15 s, $0.003). 7. Security: tamper demo, wallet-bound reference,
nullifier, two banks. 8. Integrations: Wallets Kit, RISC Zero router, Circle USDC, Reflector. 9. Traction: trades settled,
users onboarded, ads live. 10. Trust model + roadmap (timelock, enclave, inbound address, SEP-24, more banks). 11. Team.

### 3.7 Skills to use and cite
- `skills/standards/SKILL.md` (stellar-dev-skill) — we use **SEP-53** signed messages for `/api/reveal` and `/api/prove`,
  and will add **SEP-1**; cite it for both.
- `stellar-anchor-skill/SKILL.md` — read it before the anchor workshop; cite it for the SEP-24 roadmap item and the local-rail argument.
- `skills/stellar-integration-finder/SKILL.md` — cite for the Reflector choice.
- `scf-submission-radar/SKILL.md` and `stellar-scout.md` — run them on our pitch text for the post-event SCF application.
Put the list in the README ("Skills used") and in the submission form.

### 3.8 Demo-day risks and fallbacks
| Risk | Fallback |
|---|---|
| Venue Wi-Fi | phone hotspot; pre-recorded video; a reservation paid an hour earlier with the .eml on disk |
| GPU box dies | `bash ~/zkotc/bootstrap.sh` restarts in 15 s; second box rented the night before as standby |
| Ziraat/Vakıf mail slow | the pre-paid reservation; explain the flow on the recorded run |
| Bank rotates a DKIM key | `set_dkim_keys` with the new hash (2 min); `scripts/check-image-id.sh` + a key-check script the morning of |
| Judge asks "where is the anchor?" | §3.3 answer; show the settled trades; SEP-1 toml; SEP-24 on the roadmap |
| Judge asks about the operator | the How-it-works trust statement; timelock + enclave roadmap; every admin action is a public tx |

## 4. Submission checklist (do on the 19th, re-check on the 20th)
- [ ] Team name, members, contacts
- [ ] GitHub URL (public), README top section current, `hackathon.md` linked
- [ ] Live demo URL https://zkotc.vercel.app, deployment URLs (escrow, verifier router on stellar.expert), `contracts/DEPLOYMENTS.md`
- [x] Technical design doc link (`docs/TECHNICAL-DESIGN.md`) with the diagram (written 13 Sep; export the Mermaid diagram as PNG for the deck)
- [ ] Pitch deck link (copy of the official template, sharing on) — content ready in `docs/PITCH-DECK.md`
- [ ] Demo video link (2–3 min, full loop, tamper demo)
- [ ] Skill files cited by path
- [ ] Track selected: **Genesis**
- [ ] Numbers for the traction slide: settled trades, distinct wallets, ads, banks supported
