"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { OfferStatus } from "@/contracts/escrow";
import { listOffers, explainError, type Offer } from "@/lib/escrow";
import { OfferCard } from "@/components/OfferCard";
import { Alert, Button, Empty, Spinner } from "@/components/ui";
import { config, contractUrl } from "@/lib/config";

export default function Home() {
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<"open" | "all">("open");

  useEffect(() => {
    const load = () =>
      listOffers().then(
        (list) => {
          setOffers(list);
          setErr(null);
        },
        (e) => {
          setErr(explainError(e));
          setOffers([]);
        },
      );
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, []);

  const shown = (offers ?? []).filter((o) => (filter === "open" ? o.status === OfferStatus.Open || o.status === OfferStatus.Locked : true));

  return (
    <div className="space-y-8">
      <section className="grid gap-6 md:grid-cols-[1.4fr_1fr] md:items-end">
        <div>
          <h1 className="text-4xl font-semibold tracking-tight">Buy XLM or USDC with a Turkish bank transfer. No middleman.</h1>
          <p className="mt-3 max-w-xl text-muted">
            Sellers escrow crypto on Stellar. You pay them in TRY with a normal FAST transfer, then prove the payment from Ziraat&apos;s own
            e-dekont e-mail with a zero-knowledge proof. The escrow releases automatically.
          </p>
          <div className="mt-5 flex gap-3">
            <Link href="/offers/new">
              <Button>Sell crypto for TRY</Button>
            </Link>
            <Link href="/how-it-works">
              <Button variant="ghost">How the proof works</Button>
            </Link>
          </div>
        </div>
        <div className="rounded-2xl border border-line bg-panel p-4 text-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Trust model</p>
          <ul className="mt-2 space-y-1.5 text-muted">
            <li>• Funds sit in a Soroban escrow contract, never with us.</li>
            <li>• Evidence is the bank&apos;s DKIM-signed e-mail, verified inside the RISC Zero zkVM.</li>
            <li>• The Groth16 proof is checked on-chain with native BN254 pairing.</li>
          </ul>
          {config.escrowId && (
            <a className="mt-3 block text-xs underline decoration-dotted" href={contractUrl(config.escrowId)} target="_blank" rel="noreferrer">
              Escrow contract on stellar.expert ↗
            </a>
          )}
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Offers</h2>
          <div className="flex gap-1 rounded-xl border border-line p-1 text-xs">
            {(["open", "all"] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={`rounded-lg px-3 py-1 ${filter === f ? "bg-panel-2 font-semibold" : "text-muted"}`}>
                {f === "open" ? "Available" : "All"}
              </button>
            ))}
          </div>
        </div>
        {err && <Alert kind="error">{err}</Alert>}
        {!config.escrowId && <Alert kind="warn">Escrow contract id is not configured (NEXT_PUBLIC_ESCROW_ID).</Alert>}
        {offers === null ? (
          <div className="flex items-center gap-2 text-muted">
            <Spinner /> Loading offers from Soroban RPC…
          </div>
        ) : shown.length === 0 ? (
          <Empty title="No offers yet">
            Be the first: <Link className="underline" href="/offers/new">create an offer</Link>.
          </Empty>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((o) => (
              <OfferCard key={o.id.toString()} offer={o} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
