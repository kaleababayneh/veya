import { config, contractUrl } from "@/lib/config";

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-4">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent/15 text-sm font-semibold text-accent">{n}</span>
      <div><p className="font-semibold">{title}</p><p className="mt-1 text-sm text-muted">{children}</p></div>
    </li>
  );
}

export default function HowItWorks() {
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">How Veya works</h1>
        <p className="mt-2 text-muted">
          A peer-to-peer market like Binance P2P, without the platform holding anyone&apos;s money or judging disputes. No oracle, no custodian, no
          screenshots: the evidence is the bank&apos;s own cryptographic signature on the transfer receipt e-mail, checked inside a zero-knowledge proof
          that Stellar verifies on-chain.
        </p>
      </div>
      <ol className="space-y-6">
        <Step n={1} title="Makers post ads with liquidity">A seller deposits XLM or USDC into the Soroban escrow with a price in TRY, minimum and maximum trade sizes, and their bank details encrypted to the market&apos;s reveal key. Only a hash of the IBAN and name goes on-chain in the clear. A 5% bond is deposited alongside.</Step>
        <Step n={2} title="Takers reserve any amount">A buyer picks an ad, enters how much TRY to spend or how many tokens to receive, and reserves: that slice is held for 60 minutes at the quoted price. The maker&apos;s IBAN and name are revealed to the buyer after a wallet signature, and the app checks they match the on-chain hash before showing them.</Step>
        <Step n={3} title="The buyer pays by FAST and declares it">A normal instant transfer from a Ziraat or VakıfBank account, with a short payment reference in the description that ties the payment to the buyer&apos;s wallet. Declaring the payment on-chain freezes the reservation for 2 hours: nobody but the buyer can release it.</Step>
        <Step n={4} title="The bank e-mails a DKIM-signed receipt">Ziraat&apos;s e-dekont (HTML) and VakıfBank&apos;s Dekont.pdf e-mails are signed with the bank&apos;s RSA key (DKIM, the standard every mail provider checks). The receipt is inside the signed body, so it cannot be altered without breaking the signature. The buyer drops the downloaded .eml (Gmail: Show original → Download original) on the reservation page; the e-mail goes to the prover only.</Step>
        <Step n={5} title="A RISC Zero zkVM program verifies the e-mail">It checks the DKIM signature against the bank&apos;s public key, decodes the attachment, and reads the transfer: date, recipient, amount, and the payment reference. It outputs only hashes, the amount, the date and a nullifier. The dekont itself stays private.</Step>
        <Step n={6} title="Groth16 proof verified on Stellar, escrow pays out">The receipt is wrapped into a Groth16 proof over BN254, generated in about 15 seconds on a GPU prover. Soroban verifies it natively in the RISC Zero verifier router (Nethermind), then the escrow checks the payee hash, the reserved amount, the date window, the wallet reference and replay protection, and pays the buyer.</Step>
        <Step n={7} title="What protects each side">Buyer: the declared reservation cannot be released for 2 hours, and if it is released anyway a valid proof within 3 days takes the maker&apos;s bond slice. Maker: a reservation that is never paid simply expires and the liquidity returns; nobody can take tokens without a valid bank proof for exactly that reservation, and a stolen e-mail is useless to anyone but the wallet it was paid for.</Step>
      </ol>
      <div className="rounded-2xl border border-line bg-panel p-5 text-sm">
        <p className="font-semibold">Two rails to the same balance</p>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-muted"><tr><th className="py-1 pr-4"></th><th className="py-1 pr-4">Peer market (Veya)</th><th className="py-1">Licensed anchor (SEP-6)</th></tr></thead>
            <tbody className="divide-y divide-line">
              <tr><td className="py-1 pr-4 text-muted">Who uses it</td><td className="py-1 pr-4">buyers</td><td className="py-1">makers, to refill USDC inventory or cash out</td></tr>
              <tr><td className="py-1 pr-4 text-muted">Identity</td><td className="py-1 pr-4">a wallet; no KYC</td><td className="py-1">KYC at the anchor (SEP-12)</td></tr>
              <tr><td className="py-1 pr-4 text-muted">Custody</td><td className="py-1 pr-4">none: escrow contract, released by a proof</td><td className="py-1">the anchor holds the bank leg</td></tr>
              <tr><td className="py-1 pr-4 text-muted">Evidence</td><td className="py-1 pr-4">the bank&apos;s DKIM-signed receipt, verified in zero knowledge</td><td className="py-1">the anchor&apos;s own bank sees the transfer</td></tr>
              <tr><td className="py-1 pr-4 text-muted">Price</td><td className="py-1 pr-4">set by makers, competing with the anchor&apos;s rate</td><td className="py-1">USD/TRY oracle + spread (SEP-38)</td></tr>
              <tr><td className="py-1 pr-4 text-muted">Direction</td><td className="py-1 pr-4">TRY → XLM/USDC</td><td className="py-1">both ways</td></tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-muted">The anchor integration is the standard SEP client path (SEP-1 discovery, SEP-10 login, SEP-6, SEP-38), so a real Turkish anchor is a home-domain change.</p>
      </div>
      <div className="rounded-2xl border border-line bg-panel p-5 text-sm">
        <p className="font-semibold">Contracts on testnet</p>
        <ul className="mt-2 space-y-1 text-muted">
          <li>Escrow: {config.escrowId ? <a className="mono underline decoration-dotted" href={contractUrl(config.escrowId)} target="_blank" rel="noreferrer">{config.escrowId}</a> : "not configured"}</li>
          <li>RISC Zero verifier router: <a className="mono underline decoration-dotted" href={contractUrl(config.verifierId)} target="_blank" rel="noreferrer">{config.verifierId}</a></li>
        </ul>
        <p className="mt-3 font-semibold">What the operator can and cannot do today</p>
        <p className="mt-1 text-muted">
          Cannot: take anyone&apos;s funds without a valid bank proof, forge a bank receipt, or settle a reservation for a wallet other than the one
          the payment reference names. Can: read makers&apos; bank details (the reveal key is held by the operator), see the e-mails buyers upload
          (they are kept in memory only), and change the accepted zkVM program, DKIM keys or the contract code with the admin key, immediately and
          without a delay. Every such change is a public on-chain transaction. The production plan puts those changes behind a timelock and the reveal
          key inside an attested enclave; until then, treat this as a testnet demo run by a single operator.
        </p>
        <p className="mt-3 text-muted">
          Known limits of this version: payers must bank with Ziraat or VakıfBank; both banks&apos; DKIM keys are RSA-1024 (only the bank could forge); the full e-mail is shared
          with the prover you choose; the reveal service operator can read makers&apos; bank details; a proof that arrives after the 3-day window is not
          compensated; a buyer can delay a maker by the 2-hour window without paying.
        </p>
      </div>
    </div>
  );
}
