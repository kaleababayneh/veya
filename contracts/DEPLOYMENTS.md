# Testnet deployments (Stellar testnet, Protocol 28) — 2026-09-07

Deployer/admin identity: `stellarpro` (GCZYOCBQUPBSJFSKWQ7XDABIITK73XA5IVX3N4TNZDN26FTKYXEN7LZU)


Explorer: https://stellar.expert/explorer/testnet/contract/<id>

SP1-era deployments (superseded 2026-09-08): see git tag `sp1-backend`.

## RISC Zero backend (current, 2026-09-08)
| alias | what | contract id |
|---|---|---|
| otc-escrow | escrow calling the RISC Zero router; image_id 4d8dc827a6db9bbcb9117b26f6c0032ae121d7afdd6c0b8bc808a5ad45e8e384 | CCTBLF3XKBUYDT2H6T7DLYB7R2BUX2KEB43FZS6A5BKOHLN4LLQZZCZF |
| risc0 router | NethermindEth/stellar-risc0-verifier VerifierRouter | CBHIBH3T5ZZL6ZZZJFKS5QQKSB2VQ4D7GMBKQLNOQ7P2XBMPGVPG3FCG |
| risc0 groth16 verifier | params v3.0.0 (control root a54dc85a…), selector 73c457ba | CAJXPOAJXOWAHTSIGZHBHRJCMYPF7JGR7ZZLBBSUZZZ3HW23YOGZKCQI |
| emergency stop | wraps the verifier | CCKZKOFGJ2YHD7BWAH4JBGQQYCRFO4ELTK772LXMPUDDGMUTHYUUV2T4 |
| timelock | owns the router, delay 0 (testnet) | CDJ47SNGJXWT435KYW4QO4QX262RUANOKLRGHC2PLW2YI7EQHFCQAMBR |
Full state: `risc0-verifier-deployment.toml` (copied from the vendored repo's `deployment.toml`).
