> Historical research notes from 2026-09-07 (pre-migration). Tool and backend names here (zkPDF, SP1) reflect the exploration, not the current architecture — see README.

# Proof-of-payment from a bank receipt — research notes (2026-09-07)

## The receipt you have (`receipt (7).pdf`)
- Ziraat Bankası POS "dekont", 1 page, real text (not a scan), Producer = `iOS Version 18.5 Quartz PDFContext`.
- **No digital signature** (`pdfsig` → "does not contain any signatures"; no `/Sig`, `/ByteRange`).
- It is an iOS "share/print to PDF" re-render of the bank app screen. Anyone can produce an identical-looking PDF with any amount, so a ZK proof over it proves nothing about the bank — only "I hold a file that says X".
- zkPDF (and any "prove a PDF" system) is only meaningful when the PDF carries a signature from a key you can attribute to the bank.

## Option A — zkPDF (PDF must be digitally signed)
- Repo: https://github.com/privacy-ethereum/zkpdf   (cloned here: `./zkpdf`) — **archived Aug 2026**, last push 2026-05-15, still forkable.
- Template: https://github.com/privacy-ethereum/zkpdf-template (cloned here: `./zkpdf-template`) — also archived.
- Docs: `./zkpdf/docs/src/*.md`, compatibility checker: https://privacy-ethereum.github.io/zkpdf/
- Blog: https://pse.dev/blog/zkpdf-unlocking-verifiable-data  · Notes: https://hackmd.io/@sagarmarlin/BJKs_7Ojle
- Supports: PKCS#7/CMS SignedData (`adbe.pkcs7.detached`, `adbe.pkcs7.sha1`), RSA PKCS#1 v1.5 with SHA-1/256/384/512.
- Does NOT support: ECDSA, certificate-chain validation (you pin the signer's public-key hash yourself), images/OCR, form fields.
- Public values committed by the circuit (`zkpdf/circuits/lib/src/types.rs`): substringMatches, keccak(messageDigest), keccak(signerPublicKey), keccak(substring), nullifier = keccak(domain‖digestHash‖keyHash‖substringHash‖page‖offset).
- Stack: SP1 zkVM 5.0.x (`sp1-zkvm`, `sp1-sdk`, `sp1-build`), Groth16/PLONK EVM proofs, Solidity verifier in `contracts/`.
- Perf (PSE numbers): ~1 min on RTX 4090, ~13 min on 64-core CPU, much longer on laptops → use Succinct Prover Network (`SP1_PROVER=network`).
- Commands (from `zkpdf-template/script`):
  - `RUST_LOG=info cargo run --release -- --execute --pdf-path <signed.pdf>`
  - `RUST_LOG=info cargo run --release -- --prove --pdf-path <signed.pdf>`
  - `RUST_LOG=info cargo run --release --bin evm -- --system groth16`
  - `cargo run --release --bin vkey`
- Test helper: `zkpdf-template/tools/sign_pdf.py` creates RSA-SHA256 signed sample PDFs.

### How to get a signed Ziraat PDF (to test)
1. Web Internet Şubesi (not the mobile share sheet): Hesaplarım → Hesap Hareketleri → işlem detayı → "e-Dekont Görüntüle" / "PDF İndir", or "Dekont Gönder" (e-mail).
2. Check it: `pdfsig <file>.pdf` (poppler) — look for "Signature Type: adbe.pkcs7.detached / ETSI.CAdES.detached" and "Signing Hash Algorithm".
3. If RSA + SHA-256 → zkPDF works as-is. If ECDSA → zkPDF's validator needs extending (or use a different proving route).
- GİB-regulated "e-Dekont" carries an e-signature / mali mühür (İş Bankası documents this: https://www.isbank.com.tr/e-dekont-sorgulama). Whether Ziraat's PDF download embeds it is unverified — test with pdfsig.

## Option B — zkEmail (prove the bank's DKIM-signed e-mail)
- https://github.com/zkemail/zk-email-verify · docs: https://docs.zk.email/architecture/dkim-verification
- ziraatbank.com.tr publishes SPF (`-all`) and DMARC `p=quarantine; pct=100` → they very likely DKIM-sign. Find the selector in a real Ziraat e-mail header: `DKIM-Signature: ... d=ziraatbank.com.tr; s=<selector>`.
- Ziraat now sends dekont e-mails as HTML (per user reports), so amount/IBAN/date are directly in the DKIM-signed body — good for zkEmail regex circuits.
- This is exactly ZKP2P V1's design (HDFC Bank INR was proven this way).

## Option C — zkTLS / web proofs (prove data from the logged-in bank session)
- Reclaim Protocol custom providers: https://docs.reclaimprotocol.org/  · devtool: https://dev.reclaimprotocol.org/my-providers  · "The zk in zkTLS": https://blog.reclaimprotocol.org/posts/zk-in-zktls
- TLSNotary (MPC-based): https://core.taceo.io/articles/mpc-zktls/
- Works for any bank with a web/mobile API; no signed PDF needed. Trust model: notary/attestor (MPC or proxy) rather than pure ZK.

## Option D — TEE attestation (what ZKP2P/Peer V3 does today)
- Protocol docs: https://docs.peer.xyz/protocol/zkp2p-protocol · Build-your-own extension: https://docs.peer.xyz/developer/build-your-own-extension
- Contracts (MIT, Base): https://github.com/zkp2p/zkp2p-contracts — EscrowV2 / OrchestratorV2 / UnifiedPaymentVerifierV2 / registries; nullifier = keccak(paymentMethod, paymentId).
- Extension template: https://github.com/zkp2p/peer-examples (`branded-extension/`), provider templates = JSON (authLink, urlRegex, JSONPath/XPath selectors).
- Attestation Service runs in AWS Nitro Enclaves and emits EIP-712 PaymentAttestation. You already work with SGX (`sgx-anoncreds-issuer`) — the same pattern fits: enclave logs in / fetches the dekont, attests {IBAN, amount, txn id, time}.
- Solana implementation: https://github.com/zkp2p/zkp2p-solana-contracts (useful reference if targeting Stellar/Soroban).

## Reading
- zk-X509 (ZK over legacy PKI chains — what zkPDF lacks): https://arxiv.org/pdf/2603.25190
- ZKP2P V3 announcement: https://docs.zkp2p.xyz/blog/intro-zkp2p-v3

## Local test results (2026-09-07, zkpdf crates built natively)
- `verify_pdf_signature(receipt (7).pdf)` → `ERROR PDF is not digitally signed: /ByteRange not found`.
- `extract_text(receipt (7).pdf)` → works; "169,00 TRY", the IBAN, "MUTABAKAT: 8109044", "07/09/2026-18:18:39" extract as clean substrings. Turkish glyphs from the second font subset (İ Ş Ğ) come out on their own lines, so avoid substrings that span them (e.g. match "169,00 TRY" or the IBAN, not "İŞLEM TARİHİ").
- zkpdf validator on the template samples: both verify (`adbe.pkcs7.detached` RSA-SHA256 and `adbe.pkcs7.sha1` GST certificate).
- Harness source: scratchpad `receipt-check/` (10 lines, depends on `zkpdf/pdf-utils/core`).

## Desktop web dekont (`zbe-dekont.html`, 2026-09-07)
- Plain HTML (12 tables, 1 base64 PNG logo). No `<script>`, no links, no QR, no ETTN, no signature of any kind. Same trust level as the iOS PDF: unverifiable on its own.

## Ziraat e-mail (`Hesap_Hareketleri_07092026.eml`) — THIS is the signed artifact
- From `ziraat@ileti.ziraatbank.com.tr`; DKIM `d=ileti.ziraatbank.com.tr; s=msg2; a=rsa-sha256; c=relaxed/simple`, no `l=` tag.
- Gmail: dkim=pass, spf=pass, dmarc=pass. Local `dkimpy` verify against live DNS key → **True**. Recomputed `bh=` matches → the attachment is inside the signed body.
- DKIM key `msg2._domainkey.ileti.ziraatbank.com.tr` is **RSA-1024** (weak by modern standards; pin the key hash + timestamp in proofs, and expect rotation → keep a DKIM key registry like zkEmail's `DKIMRegistry`).
- Parts: 954-byte inline HTML ("İşleminizle ilgili detay ektedir") + attachment `Hesap_Hareketleri_07092026.html` (93 KB, Content-Transfer-Encoding: base64) = the 30-day statement.
- The statement contains rows like `07.09.2026 F23213 POS ALIŞVERİŞ ... MUTABAKAT: 8109044 -169,00 9.617,61` and outgoing FAST transfers with the counterparty IBAN + name — exactly the "buyer paid seller X TRY to IBAN Y on date Z" fact a P2P OTC escrow needs.
- Signed body = ~130 KB and the statement is base64 inside it → circom-style zkEmail is impractical; use the SP1 zkEmail path (`https://github.com/zkemail/sp1-zkEmail`, active, SP1) or your own SP1 program: verify DKIM (RSA-1024/SHA-256) → SHA-256 body → base64-decode attachment → parse the target row → commit {keccak(dkimKey), amount, IBAN hash, date, fiş no, nullifier=keccak(fiş no ‖ MUTABAKAT)}.
- Alternative low-effort path: run the same logic inside an SGX/Nitro enclave and emit an EIP-712 attestation (ZKP2P V3 pattern) — no ZK proving cost, trust moves to the TEE.
- DKIM `q=dns/txt` key fetch is outside the proof: the verifier (contract) must hold the trusted key hash.
