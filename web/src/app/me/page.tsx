"use client";
import { useEffect, useState } from "react";
import { OfferStatus } from "@/contracts/escrow";
import { useWallet } from "@/lib/wallet";
import { listOffers, explainError, type Offer } from "@/lib/escrow";
import { OfferCard } from "@/components/OfferCard";
import { Alert, Button, Empty, Spinner } from "@/components/ui";

function Section({ title, items }: { title: string; items: Offer[] }) {
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      {items.length === 0 ? <Empty title="Nothing here yet" /> : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{items.map((o) => <OfferCard key={o.id.toString()} offer={o} />)}</div>}
    </section>
  );
}

export default function Me() {
  const { address, connect } = useWallet();
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    listOffers().then(setOffers).catch((e) => { setErr(explainError(e)); setOffers([]); });
  }, []);
  if (!address) return <Empty title="Connect your wallet to see your offers and purchases"><Button onClick={connect}>Connect wallet</Button></Empty>;
  if (offers === null) return <div className="flex items-center gap-2 text-muted"><Spinner /> Loading…</div>;
  const selling = offers.filter((o) => o.seller === address);
  const buying = offers.filter((o) => o.buyer === address && o.status !== OfferStatus.Cancelled);
  return (
    <div className="space-y-8">
      {err && <Alert kind="error">{err}</Alert>}
      <Section title="Buying (reserved or completed)" items={buying} />
      <Section title="Selling" items={selling} />
    </div>
  );
}
