# zkotc-lib

zkVM-agnostic core shared by the RISC Zero guest and the host prover. Pure Rust, no I/O.

| module | responsibility |
|---|---|
| `dkim` | RFC 6376 verification (rsa-sha256, simple/relaxed canonicalization, `l=`), header parsing, `selector_and_domain` |
| `mime` | pull the `e-dekont.html` attachment out of the signed multipart body (base64 / quoted-printable) |
| `dekont` | parse Ziraat's per-transaction e-dekont: account IBAN, date/time/fiş no, direction, amount, counterparty IBAN |
| `text` | Turkish amount/date parsing, IBAN search, HTML text cleanup |
| `lib` | `ProverInput` → `prove_payment` → `PaymentClaim` (152-byte journal), nullifier, `inspect_dekont` for the host |

```sh
cargo test          # unit tests + tests against a real e-mail in testdata/private/ (git-ignored, skipped if absent)
```
`testdata/ziraat-ileti-msg2.der` is Ziraat's DKIM public key (`msg2._domainkey.ileti.ziraatbank.com.tr`).
