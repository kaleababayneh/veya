# web

Next.js 16 front-end for zkOTC: offer board, sell form, and the buyer flow (reserve → pay by FAST →
upload the Ziraat statement `.eml` → proof job → claim). Wallets via Stellar Wallets Kit; contract
calls via the generated bindings in `src/contracts/escrow.ts` (regenerate with
`stellar contract bindings typescript --wasm ../contracts/target/wasm32v1-none/release/zkotc_escrow.wasm --output-dir <tmp>`
and copy `src/index.ts`).

```sh
cp .env.example .env.local   # contract ids, RPC, prover URL
npm install && npm run dev   # http://localhost:3000
npm run lint && npm run build
```
