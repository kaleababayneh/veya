# Testnet deployments (Stellar testnet, Protocol 28) — 2026-09-07

Deployer/admin identity: `stellarpro` (GCZYOCBQUPBSJFSKWQ7XDABIITK73XA5IVX3N4TNZDN26FTKYXEN7LZU)


Explorer: https://stellar.expert/explorer/testnet/contract/<id>

SP1-era deployments (superseded 2026-09-08): see git tag `sp1-backend`.

## RISC Zero backend (current, 2026-09-08)
| alias | what | contract id |
|---|---|---|
| **otc-escrow-v4** (current, 2026-09-09) | escrow with `declare_paid` protection + 5 % seller bond + late `claim_bond`; image_id eaf273e6fcbbbe98ce40febd9583beb50ef1ee6f4fb3cd791239993921ae6e58 (GPU prover build); lock 3600 s, proof window 7200 s, late-claim window 3 d, fee 25 bps | CBYZNQAOVAT5QDM6FQHKSWDOQDLA7AJ53PFZ6DLNC47A3YAR4KN6VCHV |
| otc-escrow (v3, superseded 2026-09-09; offer #1 cancelled) | escrow calling the RISC Zero router; image_id 9ec8ddc3193d4b3a0a6ce64efbdbbf07ddf8f23e0ddc943db130f64259087cbf | CBVLRH22A6QWM53NDMYKYTSNS5M7472IPLRJTSWCMU4WHBCX6JBZ5ERW |
| risc0 router | NethermindEth/stellar-risc0-verifier VerifierRouter | CBHIBH3T5ZZL6ZZZJFKS5QQKSB2VQ4D7GMBKQLNOQ7P2XBMPGVPG3FCG |
| risc0 groth16 verifier | params v3.0.0 (control root a54dc85a…), selector 73c457ba | CAJXPOAJXOWAHTSIGZHBHRJCMYPF7JGR7ZZLBBSUZZZ3HW23YOGZKCQI |
| emergency stop | wraps the verifier | CCKZKOFGJ2YHD7BWAH4JBGQQYCRFO4ELTK772LXMPUDDGMUTHYUUV2T4 |
| timelock | owns the router, delay 0 (testnet) | CDJ47SNGJXWT435KYW4QO4QX262RUANOKLRGHC2PLW2YI7EQHFCQAMBR |
Full state: `risc0-verifier-deployment.toml` (copied from the vendored repo's `deployment.toml`).

2026-09-10 escrow v4 dry run with the real receipt (offer #1: 5 XLM for ₺50, payee = the real recipient, locked + `declare_paid`
by `zkotc-buyer` GDZSGQN6…): `fulfill` failed with `Error(Contract, #16)` DateOutOfWindow — i.e. the Groth16 receipt verified
through the router inside the escrow call, the payee binding matched the offer, the amount check passed, and only the
anti-replay rule (dekont dated 05.09 < lock day) blocked settlement. A same-day transfer completes the flow.

First real receipt verified on-chain via the router: https://stellar.expert/explorer/testnet/tx/27a5f44d076e05f978237f55110e7212e38decf180f14d5472e14cfd8d8b36d3 (2026-09-08, image id 9ec8ddc3…, fee 222957 stroops).
