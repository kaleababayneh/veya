import { config, contractUrl } from "@/lib/config";

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-4">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent/15 font-semibold text-accent">{n}</span>
      <div><p className="font-semibold">{title}</p><p className="mt-1 text-sm text-muted">{children}</p></div>
    </li>
  );
}

export default function HowItWorks() {
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">How a bank transfer unlocks crypto</h1>
        <p className="mt-2 text-muted">No oracle, no custodian, no screenshots. The evidence is the bank&apos;s own cryptographic signature.</p>
      </div>
      <ol className="space-y-5">
        <Step n={1} title="Seller escrows crypto on Soroban">XLM or USDC is transferred into the escrow contract together with the TRY price and the seller&apos;s IBAN.</Step>
        <Step n={2} title="Buyer reserves and pays by FAST">The reservation is a Stellar transaction. The buyer sends the exact TRY amount from a Ziraat account and asks Ziraat to e-mail the dekont. FAST settles in seconds.</Step>
        <Step n={3} title="Ziraat e-mails the transfer&apos;s dekont — DKIM-signed">Ziraat signs every e-mail with its DKIM key (RSA-SHA256, domain ileti.ziraatbank.com.tr). The e-dekont attachment is inside the signed body, so it cannot be altered without breaking the signature.</Step>
        <Step n={4} title="RISC Zero zkVM verifies the e-mail and extracts the payment">A Rust program checks the DKIM signature against the bank&apos;s public key, decodes the e-dekont attachment, and reads the transfer: date, recipient IBAN, amount. It outputs only hashes, the amount, the date and a nullifier. The dekont itself stays private.</Step>
        <Step n={5} title="Groth16 proof verified on Stellar">The receipt is wrapped into a Groth16 proof over BN254. Soroban verifies it natively in the RISC Zero verifier router (Nethermind), the same verifier used by Stellar&apos;s Confidential Token preview, then the escrow checks IBAN hash, amount, date window and replay protection, and pays the buyer.</Step>
        <Step n={6} title="What protects the buyer after the money has left the bank">The buyer pays off-chain, so a plain timer would let a seller withdraw the moment it runs out. Instead the buyer <b>declares the payment</b> on-chain right after sending it: from then on nobody but the buyer can release the reservation for the proof window (2 hours), long enough for the e-mail and a 15-second proof. Every seller also posts a <b>5% bond</b> with the offer. If the seller withdraws after a declared payment and the buyer proves it within 3 days, the bond goes to the buyer; otherwise it returns to the seller. A buyer who declares without paying only delays the seller by the proof window, and can never take the funds without a valid bank proof.</Step>
      </ol>
      <div className="rounded-2xl border border-line bg-panel p-5 text-sm">
        <p className="font-semibold">Contracts on testnet</p>
        <ul className="mt-2 space-y-1 text-muted">
          <li>Escrow: {config.escrowId ? <a className="mono underline decoration-dotted" href={contractUrl(config.escrowId)} target="_blank" rel="noreferrer">{config.escrowId}</a> : "not configured"}</li>
          <li>RISC Zero verifier router: <a className="mono underline decoration-dotted" href={contractUrl(config.verifierId)} target="_blank" rel="noreferrer">{config.verifierId}</a></li>
        </ul>
        <p className="mt-3 text-muted">Known limits of this version: payer must bank with Ziraat; the DKIM key is RSA-1024 (only the bank could forge it); the full e-mail is shared with the prover you choose; the seller&apos;s IBAN and name are public on-chain; a late proof after the 3-day window is not compensated.</p>
      </div>
    </div>
  );
}
