# Testnet deployments (Stellar testnet, Protocol 28) — 2026-09-07

Deployer/admin identity: `stellarpro` (GCZYOCBQUPBSJFSKWQ7XDABIITK73XA5IVX3N4TNZDN26FTKYXEN7LZU)


Explorer: https://stellar.expert/explorer/testnet/contract/<id>

SP1-era deployments (superseded 2026-09-08): see git tag `sp1-backend`.

## RISC Zero backend (current, 2026-09-08)
| alias | what | contract id |
|---|---|---|
| **otc-escrow-v5** (current, 2026-09-10) | **P2P market**: maker ads (liquidity + price + per-trade limits + encrypted payee details) and per-trade reservations; `declare_paid`, per-reservation bond slices, `claim_bond`/`reclaim_bond`, wallet-bound payment reference; image_id 64c9d9d7…d4d0 (set_config tx ef13178d…, 2026-09-12; was 89f97cff…3775); **upgraded in place 2026-09-12** to wasm 07be6c659aa21bbcb695419aaa8f2805236583a2cfa60ec21326e22e2907c0f0 (payment reference is one token `ZKOTC<id><hex6>`; reservations #1–#7 were made with the spaced form and #7 settled with it before the upgrade); lock 3600 s, proof window 7200 s, bond 5 %, late-claim 3 d, fee 25 bps, ₺50–₺5000, ≤5 reservations/ad, ≤2 active/buyer; reveal_pubkey 7058347fc86ef5ac89b17f93f2e9ff3d0f828c235921fd3c34860b651d29a95c (secret in web/.env.local `REVEAL_SECRET_KEY`) | CAFU5GMKM3UNZ3VLOZ7HX5HDFB7L7U2HM3UZLYLTFHIQLILIEYN5SDLG |
| **otc-escrow-v4** (current, 2026-09-09) | escrow with `declare_paid` protection + 5 % seller bond + late `claim_bond`; image_id eaf273e6fcbbbe98ce40febd9583beb50ef1ee6f4fb3cd791239993921ae6e58 (GPU prover build); lock 3600 s, proof window 7200 s, late-claim window 3 d, fee 25 bps | CBYZNQAOVAT5QDM6FQHKSWDOQDLA7AJ53PFZ6DLNC47A3YAR4KN6VCHV |
| otc-escrow (v3, superseded 2026-09-09; offer #1 cancelled) | escrow calling the RISC Zero router; image_id 9ec8ddc3193d4b3a0a6ce64efbdbbf07ddf8f23e0ddc943db130f64259087cbf | CBVLRH22A6QWM53NDMYKYTSNS5M7472IPLRJTSWCMU4WHBCX6JBZ5ERW |

### Retired escrows (2026-09-10)
Soroban contracts cannot be deleted. Every superseded escrow was **emptied and paused** (`set_paused(true)`: no new offers or
locks; leftover settlements stay possible) and is no longer referenced by the app. Their ledger entries expire when nobody
bumps the TTL (instance ≤ 120 days after the last bump). Balances after clean-up: v3 CBVLRH22… 0, v2 CCTBLF3X… 0, SP1-era
CCEZJMQD… 0 (offer #2, 5 XLM, cancelled), v4 CBYZNQAO… offer #1 cancelled (5.25 XLM back); offer #2 (locked+declared by a
user wallet) released + cancelled after its window — its 0.25 XLM bond is held until the 3-day late-claim window ends
(`withdraw_bond 2` from `stellarpro` after 2026-09-13 ~00:00 UTC). To make a retired contract fully inert, `upgrade` it to a
stub wasm once its balance is zero.
| risc0 router | NethermindEth/stellar-risc0-verifier VerifierRouter | CBHIBH3T5ZZL6ZZZJFKS5QQKSB2VQ4D7GMBKQLNOQ7P2XBMPGVPG3FCG |
| risc0 groth16 verifier | params v3.0.0 (control root a54dc85a…), selector 73c457ba | CAJXPOAJXOWAHTSIGZHBHRJCMYPF7JGR7ZZLBBSUZZZ3HW23YOGZKCQI |
| emergency stop | wraps the verifier | CCKZKOFGJ2YHD7BWAH4JBGQQYCRFO4ELTK772LXMPUDDGMUTHYUUV2T4 |
| timelock | owns the router, delay 0 (testnet) | CDJ47SNGJXWT435KYW4QO4QX262RUANOKLRGHC2PLW2YI7EQHFCQAMBR |
Full state: `risc0-verifier-deployment.toml` (copied from the vendored repo's `deployment.toml`).

2026-09-10 escrow v4 dry run with the real receipt (offer #1: 5 XLM for ₺50, payee = the real recipient, locked + `declare_paid`
by `zkotc-buyer` GDZSGQN6…): `fulfill` failed with `Error(Contract, #16)` DateOutOfWindow — i.e. the Groth16 receipt verified
through the router inside the escrow call, the payee binding matched the offer, the amount check passed, and only the
anti-replay rule (dekont dated 05.09 < lock day) blocked settlement. A same-day transfer completes the flow.

**2026-09-10 — v4 upgraded in place** (`upgrade`, wasm fcc7edce402a4116c33973a361aae8454bb5c8acbfb5c6be38e656c56a40d877): 184-byte journal with
`reference_hash`, `ReferenceMismatch` (#34), `payment_reference(id, buyer)` view; `set_config` image_id → 89f97cff1e49847dd9435895a3e1409e95a1038f3728e4870d98567754193775
(guest with the payment-reference check, parser hardening and the `l=` refusal). Offers created before the upgrade remain readable.

**2026-09-10 01:00 Istanbul — first full settlement:** offer #3 (10 XLM for ₺50, seller GBB7AE…, buyer GCKKGU… via Freighter),
`declare_paid` a2d2aa30…, real ₺50 FAST at 00:58, proof ~15 s, `fulfill` + `bond_returned` in tx
afdbb4c22149d0143c35134b1c12a281ca619c4051191442d03a52cfcbc37fae (ledger 4593532). Offer #2 remains locked+declared by the
same buyer (no payment); the buyer can `unlock` it or the seller cancels after the window (bond then held 3 days).

First real receipt verified on-chain via the router: https://stellar.expert/explorer/testnet/tx/27a5f44d076e05f978237f55110e7212e38decf180f14d5472e14cfd8d8b36d3 (2026-09-08, image id 9ec8ddc3…, fee 222957 stroops).

**2026-09-12 — first full v5 trade through the UI:** reservation #7 on ad #3 (₺50 FAST with the typed reference
`ZKOTC 7 089340`, Ziraat prints the typed text in front of its own fields), proof 12.8 s on the GPU, settled 17:33 Istanbul.
Guest image id switched to 64c9d9d7… for the typed-açıklama parser fix (commit e628033), then the escrow was upgraded in
place (wasm 07be6c65…) for the single-token reference format; the guest is unchanged by that, so the image id stayed.

**2026-09-12 — VakıfBank added as a second bank:** escrow upgraded in place (wasm 36a6d1fb9ef0eee8a352268b42cc48ecf44d46b391377d460399d4bfa0be69c8:
`set_domains`/`domains`), extra domain aa9912ff… (`vakifbank.com.tr`) and DKIM key hash 019680d5… (`smtp2`) registered; guest image id switched to
aa06027db8c3d4877dd43d5117c7408f11765cff75db3f618059e0cc13916e4b (tx 8a7b1e3b…; Vakıf PDF provider + Gmail Message-ID repair, commit fcf41a4).
