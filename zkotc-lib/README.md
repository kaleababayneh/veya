# zkotc-lib

zkVM-agnostic core shared by the RISC Zero guest and the host prover. Pure Rust, no I/O.

| module | responsibility |
|---|---|
| `dkim` | RFC 6376 verification (rsa-sha256, simple/relaxed canonicalization, `l=`), header parsing, `selector_and_domain` |
| `mime` | pull the `Hesap_Hareketleri_*.html` attachment out of the signed multipart body (base64 / quoted-printable) |
| `statement` | parse the Ziraat statement: account IBAN, rows (date, fiş no, description, amount, balance), IBAN search |
| `lib` | `ProverInput` → `prove_payment` → `PaymentClaim` (152-byte journal), nullifier, `find_payment_row` for the host |

```sh
cargo test          # unit tests + tests against a real e-mail in testdata/private/ (git-ignored, skipped if absent)
```
`testdata/ziraat-ileti-msg2.der` is Ziraat's DKIM public key (`msg2._domainkey.ileti.ziraatbank.com.tr`).
