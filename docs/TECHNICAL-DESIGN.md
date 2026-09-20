# zkOTC — technical design

*Status 13 September 2026, Stellar testnet. Companion to the [README](../README.md) (what it is), [ROADMAP](ROADMAP.md) (what is next)
and [hackathon.md](../hackathon.md) (how it maps to the Pro Hackathon rubric).*

zkOTC is a peer-to-peer market where a buyer pays a maker Turkish lira by an ordinary FAST bank transfer and receives XLM or
USDC from a Soroban escrow. The escrow releases only on a zero-knowledge proof that the bank's own DKIM-signed receipt e-mail
describes that exact payment: right account, right amount, right day, and a reference naming the buyer's wallet. No custodian,
no oracle, no dispute desk: the bank's signature is the evidence.

## 1. Architecture

```mermaid
flowchart LR
  subgraph Buyer["Buyer (browser + Freighter)"]
    W[Web app<br/>Next.js on Vercel]
  end
  subgraph Bank["Bank (Ziraat / VakıfBank)"]
    FAST[FAST transfer] --> MAIL[DKIM-signed<br/>receipt e-mail]
  end
  subgraph API["Web API (Vercel, Node)"]
    REV[/api/reveal<br/>opens the sealed IBAN/]
    PROVE[/api/prove<br/>wallet-signed gate/]
  end
  subgraph Prover["Prover box (rented RTX 4090)"]
    HOST[zkotc-server<br/>validate → execute → STARK → Groth16]
    GUEST[RISC Zero guest<br/>DKIM · MIME · receipt parser]
    HOST --- GUEST
  end
  subgraph Stellar["Stellar testnet"]
    ESC[otc-escrow v5<br/>Soroban]
    VER[RISC Zero verifier router<br/>Nethermind]
    ESC -- verify(seal, image_id, sha256(journal)) --> VER
  end
  ANCH[TR anchor<br/>SEP-1/10/6/38]

  W -- reserve / declare_paid / settle --> ESC
  W -- signed message --> REV
  REV -- get_ad, get_reservation --> ESC
  MAIL -. .eml download .-> W
  W -- .eml + signed message --> PROVE
  PROVE -- reservation check --> ESC
  PROVE -- job --> HOST
  HOST -- journal + seal --> W
  W -. makers only: fund USDC, cash out .-> ANCH
```

| Component | Where | Language / stack | Role |
|---|---|---|---|
| `zkotc-lib` | `zkotc-lib/` | Rust, zkVM-agnostic | DKIM verifier (RFC 6376, rsa-sha256, simple/relaxed), MIME attachment extraction, bank providers (Ziraat HTML dekont parser, VakıfBank PDF dekont extractor + parser), payee hash, payment reference, 184-byte journal. Shared by host and guest. |
| RISC Zero guest | `prover/methods/guest` | Rust on risc0 3.0.6 | Runs `prove_payment` on the e-mail bytes + DKIM key + reference; commits the journal. Image id pinned in `prover/IMAGE_ID`. |
| `zkotc-server` / `zkotc` CLI | `prover/host` | Rust, axum, CUDA | Validates the e-mail before proving (same parser as the guest), computes the attachment hint, runs executor → STARK (GPU) → succinct → identity_p254 → Groth16 (ICICLE-snark on the GPU, or the reference CPU prover), serves `/jobs`. |
| Escrow | `contracts/escrow` | Soroban (soroban-sdk 27) | Ads, reservations, quotes, `declare_paid` protection, per-reservation bond slices, settlement on a verified proof, nullifiers, bank domain/key allow-lists, admin/upgrade. |
| Verifier router | Nethermind's deployment | Soroban | Groth16 verification over BN254 with native host functions; the escrow calls `verify(seal, image_id, journal_digest)`. |
| Web app | `web/` | Next.js 16, React 19, Stellar Wallets Kit, generated contract bindings | Market, ads, the reservation wizard, maker pages, `/api/reveal`, `/api/prove`, `/anchor`, SEP-1 `stellar.toml`. |
| GPU runbook | `scripts/gpu/` | bash | One command from a fresh Vast.ai box to a serving prover: artifacts from an Azure host, checksums, Caddy HTTPS proxy re-pointed, escrow image-id switch. |

## 2. One trade, end to end

1. **Maker posts an ad** (`create_ad`): deposits N tokens plus a 5 % bond, sets a TRY price and per-trade limits. The IBAN and account
   name are encrypted in the browser to the market's X25519 key (libsodium sealed box) and stored on-chain as ciphertext plus
   `payee_hash`. Nothing readable is on-chain.
2. **Buyer reserves** (`reserve`): picks an amount within the limits; the escrow holds that slice and a bond slice for 60 minutes.
   Caps: 5 active reservations per ad, 2 per wallet.
3. **Reveal**: the buyer signs `zkotc reveal ad A reservation R at T` (SEP-53 style, no transaction). `/api/reveal` verifies the
   signature, checks on-chain that the wallet holds a live reservation, opens the sealed box and returns the IBAN, name and bank.
   The browser recomputes `payee_hash` and compares it with the ad's commitment before showing anything ("verified").
4. **Pay**: an ordinary FAST transfer from the buyer's Ziraat or VakıfBank account, with the payment reference `ZKOTC<R><6 hex>`
   typed into the açıklama. The six characters are the first three bytes of sha256 of the buyer's wallet address.
5. **Declare** (`declare_paid`): freezes the reservation for 2 hours (the maker cannot release) and earmarks the bond slice.
6. **Get the receipt**: Ziraat Mobil / VakıfBank Mobil → the transfer → Dekont → E-posta. The bank e-mails a DKIM-signed message
   with the receipt inside the signed body (HTML for Ziraat, PDF for VakıfBank). The buyer downloads the original `.eml` from Gmail.
7. **Prove**: the buyer drops the `.eml`; the browser signs `zkotc prove reservation R at T`; `/api/prove` verifies the signature,
   confirms the reservation on-chain, opens the payee details server-side and forwards the e-mail to the prover with a server-only
   token. The host re-checks everything the guest will check (fail fast in a second), then proves: ~15 s for a Ziraat receipt,
   ~25 s for a VakıfBank PDF, on a rented RTX 4090.
8. **Settle** (`settle`): the buyer submits the 184-byte journal and the 260-byte Groth16 seal. The escrow asks the verifier router
   to verify the seal against the configured guest image id and the journal digest, then checks every field of the journal
   (§4) and pays the buyer, minus a 0.25 % fee, freeing the bond slice.

If a maker releases a declared reservation after the 2-hour window, the buyer can still `claim_bond` with the same proof for
3 days and take the maker's bond slice; after that the maker `reclaim_bond`s. A never-declared reservation simply expires.

## 3. What the guest verifies

Input: the raw e-mail bytes (CRLF-normalised by the host), the bank's DKIM public key (DER), the reservation id, the expected
reference, and an optional attachment hint (byte offsets computed by the host and re-verified in the guest so the guest never
scans the MIME body).

1. **DKIM** (`dkim.rs`): parses the `DKIM-Signature` header, refuses `l=` (a length-limited body hash would let anyone append an
   unsigned attachment), canonicalises headers and body (simple or relaxed), checks the body hash, verifies the RSA-SHA256
   signature with the given key. The `From` domain must equal the DKIM `d=` domain. Gmail-specific repair: Gmail rewrites a
   malformed `Message-ID` after verifying and keeps the signed value in `X-Google-Original-Message-ID`; the verifier uses the
   preserved value, otherwise every VakıfBank mail downloaded from Gmail fails.
2. **Provider** (`Provider::for_domain`): `ileti.ziraatbank.com.tr` → HTML dekont; `vakifbank.com.tr` → PDF dekont. The escrow
   separately checks that the domain hash and the key hash are on its allow-lists.
3. **Attachment** (`mime.rs`): the base64 part named `e-dekont*.html` or `Dekont*.pdf` inside the signed body, decoded with a
   4-table decoder that handles the bank's 68/76-column wrapping.
4. **Receipt parsing**: Ziraat (`dekont.rs`): HTML table rows; direction needs three bank-generated anchors to agree (title
   `HESAPTAN…`, the `Fast Mesaj Kodu :` block, the `Hesabınızdan … Çekilmiştir` sentence); bank fields are read only from the
   block that starts at the last `Fast Mesaj Kodu :` anchor, so text the payer typed (printed in front of it) cannot impersonate
   them. VakıfBank (`pdf.rs` + `vakif.rs`): inflate the page content stream, one string per table cell (labels and values are
   separate cells, CID glyphs mapped through the fonts' ToUnicode tables), values taken only as "the cell after the first exact
   label cell"; direction from `FAST Giden` vs `Gelen`.
5. **Checks**: outgoing transfer; recipient IBAN + bank + name hash to `payee_hash`; the expected reference appears as a whole
   token in the payer's description; amount and date are read from the bank's fields.
6. **Journal** (184 bytes): `dkim_key_hash ‖ domain_hash ‖ payee_hash ‖ amount_kurus ‖ date_yyyymmdd ‖ nullifier ‖ reservation_id ‖
   reference_hash`. Only hashes, the amount, the date and a nullifier leave the guest; the receipt itself never does.

`payee_hash = sha256("zkotc/payee/v1" ‖ iban[0..4] ‖ iban[4..9] ‖ iban[20..26] ‖ fold(name))` uses the parts a masked Ziraat
receipt prints and a full IBAN also contains, so the same commitment works for both banks and the maker never reveals the full
IBAN on-chain. `nullifier = sha256("stellarpro/zkotc/nullifier/v3-dekont" ‖ domain_hash ‖ FAST sorgu no ‖ account ‖ date ‖ time ‖
fiş no ‖ amount ‖ description ‖ settlement)` is unique per receipt and stored forever by the escrow.

## 4. What the escrow checks at settlement

`verify_and_consume(reservation, buyer, public_values, proof)`, in order: the caller is the reservation's buyer (auth);
the reservation is Active or Released within its late-claim window; the verifier router accepts the seal for the configured
`image_id` and `sha256(public_values)`; `reservation_id` in the journal equals this reservation; `dkim_key_hash` is in the
allowed set; `domain_hash` is the config domain or in the extra-domains list; `payee_hash` equals the ad's commitment;
`amount_kurus ≥` the reservation's TRY amount; the date is between the reservation day and today (Istanbul); the nullifier is
unused; `reference_hash == sha256(payment_reference(reservation_id, buyer))`. Then it pays the buyer, takes the fee, frees the
bond slice and records the nullifier.

Escrow parameters on testnet: lock 3600 s, proof window 7200 s, bond 5 %, late-claim window 3 days, fee 25 bps, ₺50–₺5000 per
trade, ≤ 5 reservations per ad, ≤ 2 active per buyer. Contract ids and every deployment step are in
[`contracts/DEPLOYMENTS.md`](../contracts/DEPLOYMENTS.md).

## 5. Trust model

| Party | Can | Cannot |
|---|---|---|
| Another user | reserve, pay, prove their own transfers | take tokens without a valid proof of a transfer to the maker's committed IBAN; use someone else's receipt (reference names the wallet; nullifier stops reuse); dress an incoming transfer up as outgoing; inject bank fields through the açıklama |
| The maker | post, price, close ads, release after the window | release a declared reservation during the 2-hour window; escape the bond slice if a proof arrives within 3 days |
| The bank | sign receipts | be impersonated: the escrow accepts only the pinned domain/key hashes; RSA-1024 keys (both banks) are the weakest link and belong to the banks |
| The operator (today) | read makers' IBANs (holds the reveal key), see uploaded e-mails (memory only), change the accepted guest image id, DKIM keys, domains or contract code with the admin key, immediately | forge a receipt or a proof; take funds without a proof; hide a change (every admin action is a public transaction) |

The operator column is the honest gap. The production plan (ROADMAP §C) is a timelock on admin actions longer than any
reservation window, a reproducible guest build so the image id can be checked against the source, a multisig admin, and the
reveal key inside an attested SGX enclave so the operator cannot read IBANs either.

## 6. Design decisions and trade-offs

| Decision | Why | Trade-off |
|---|---|---|
| **Evidence = the bank's DKIM-signed receipt e-mail** (zkEmail), not screenshots, PDFs or zkTLS | Ziraat's and VakıfBank's PDFs and shared images are unsigned; the e-mail is signed with the bank's RSA key and the receipt sits inside the signed body. zkTLS would need a per-bank session proof and a notary; TEE-based approaches trust hardware vendors (RESEARCH-NOTES) | Users must fetch the `.eml` from a computer; a phone cannot export it. Gmail OAuth was built and dropped (Google's restricted-scope review blocks an open demo); the production path is an inbound address per wallet with a one-time forwarding rule |
| **RISC Zero + Nethermind's verifier router** rather than SP1 + our own verifier | Stellar's own docs and the Confidential Token preview use this stack; a governed, versioned verifier on-chain beats a hand-rolled one | The guest image id is not reproducible across machines without the Docker build; every guest change needs an escrow `set_config` (automated in `deploy.sh`) |
| **Rented GPU with a one-command runbook** instead of a fixed prover host | 84 min per proof on a 4-vCPU CPU box → 15 s on a 4090 at $0.36/h (≈ $0.003 per proof); a fresh box serves in 4–10 min from artifacts on an Azure host | The prover is a single ephemeral box; jobs live in memory (a restart only loses in-flight jobs; the buyer re-uploads) |
| **ICICLE-snark GPU Groth16 wrap + the reference CPU prover as fallback** | risc0 3.0.x's own CUDA wrap crashes (risc0#3785); ICICLE proves in ~2.5 s, the CPU prover in ~19 s | Two more binaries to ship; a 3.6 GB zkey on every box |
| **Market model (ads + reservations)** instead of fixed offers | Binance-P2P shape: makers post liquidity with limits, takers take any slice; per-reservation bond slices keep the maker honest per trade | More contract surface (22 tests); caps needed against reservation griefing |
| **Wallet-bound payment reference in the açıklama** | A receipt is a document anyone could obtain; the reference makes it useful to exactly one wallet, and lets the maker match a bank credit to a reservation | Buyers must type 12 characters correctly; the parser must treat the typed text as hostile (it is printed in front of the bank's fields) |
| **Sealed IBANs with a server-side reveal after a wallet signature** | Nothing readable on-chain; only a wallet holding a reservation sees the details, and verifies them against the commitment | The operator holds the key (enclave on the roadmap) |
| **`/api/prove` gate: wallet signature + on-chain reservation** | Stops anyone from burning GPU time; keeps the prover token out of the browser; derives every prover parameter from the chain | One more wallet prompt per proof |
| **Anchor as the makers' rail, not a buyer option** | The hackathon requires an anchor integration and DevRel's mock anchor speaks SEP-6; makers genuinely need a licensed rail to refill inventory and cash out; the anchor's SEP-38 rate is the price the peer market competes with | It is a second door that must not dilute the story; it lives on a maker page and never touches the buyer flow |

## 7. Challenges overcome

- **84 minutes → 15 seconds.** Guest cycles cut from 5.19 M to 2.06 M (host-computed attachment offsets re-verified in the guest,
  a 4-table base64 decoder with dynamic line width, a fused HTML tokenizer, CRLF normalisation on the host), then GPU STARK +
  ICICLE Groth16. Segment size tuned to the 4090's 24 GB.
- **The CUDA Groth16 wrap crashes on risc0 3.0.x.** Worked around with the reference CPU prover extracted from risc0's Docker image
  (no Docker on rented boxes), then replaced by the ICICLE-snark worker with a persistent process and death-signal binding.
- **How Ziraat prints a typed description.** Unknown until the first real transfer with a reference: the typed text is printed
  in front of the bank's fields, not after an `Açıklama :` label. The parser was re-anchored on the last `Fast Mesaj Kodu :` block,
  with injection tests for both layouts.
- **VakıfBank's PDF receipts.** Aspose-generated PDFs draw each table cell as its own text block; a small no_std-friendly inflate +
  text-operator scanner in the guest turns them into label/value cells without any layout math. The recipient name lives in a
  CID font, decoded through the embedded ToUnicode maps.
- **Gmail breaks VakıfBank's DKIM.** VakıfBank signs a bare-number `Message-ID`; Gmail verifies, then rewrites it and preserves the
  original in `X-Google-Original-Message-ID`. Without restoring it, no downloaded VakıfBank mail verifies anywhere.
- **Reproducible operations.** Three separate incidents where a guest change silently invalidated the escrow config led to the
  image-id pin, the three-way check script and CI.

## 8. Numbers

| | Ziraat (HTML) | VakıfBank (PDF) |
|---|---|---|
| Guest cycles | 2.6 M | 10.5 M |
| STARK + succinct (RTX 4090) | ~5 s | ~13 s |
| Groth16 wrap (ICICLE, warm) | ~2.5 s | ~2.5 s |
| API end to end | ~15 s | ~25 s |
| On-chain | 260-byte seal + 184-byte journal, one `settle` transaction | same |
| Cost per proof | ≈ $0.003 at $0.36/h | ≈ $0.005 |

## 9. Repository map

`zkotc-lib/` core (16 unit tests + 10 on real e-mails, the real samples are git-ignored) · `prover/` guest, host, server,
`IMAGE_ID` · `contracts/escrow/` (22 tests) + `DEPLOYMENTS.md` · `web/` app + API routes + `stellar.toml` · `scripts/gpu/` runbook,
`scripts/check-image-id.sh` · `docs/` this file, `GPU.md`, `OPERATIONS.md`, `ROADMAP.md`, `DEMO-SCRIPT.md`, `RESEARCH-NOTES.md`.
CI runs the three test suites, web lint/types/build and the image-id pin check on every push.
