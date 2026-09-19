"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { AdStatus, ReservationStatus } from "@/contracts/escrow";
import { useWallet } from "@/lib/wallet";
import { listAds, listReservations, explainError, type Ad, type Reservation } from "@/lib/escrow";
import { fmtToken, fmtTRY, fmtDate, nowSec, short } from "@/lib/format";
import { tokenByAddress } from "@/lib/tokens";
import { AdBadge, Alert, Button, Empty, ReservationBadge, Spinner } from "@/components/ui";

export default function Me() {
  const { address, connect } = useWallet();
  const [ads, setAds] = useState<Ad[] | null>(null);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([listAds(), listReservations()])
      .then(([a, r]) => {
        setAds(a);
        setReservations(r);
      })
      .catch((e) => {
        setErr(explainError(e));
        setAds([]);
      });
  }, []);

  if (!address) return <Empty title="Connect your wallet to see your ads and reservations"><Button onClick={connect}>Connect wallet</Button></Empty>;
  if (ads === null) return <div className="flex items-center gap-2 text-muted"><Spinner /> Loading…</div>;

  const now = nowSec();
  const adById = new Map(ads.map((a) => [a.id.toString(), a]));
  const myAds = ads.filter((a) => a.seller === address);
  const myAdIds = new Set(myAds.map((a) => a.id.toString()));
  const buying = reservations.filter((r) => r.buyer === address);
  const incoming = reservations.filter((r) => myAdIds.has(r.ad_id.toString()));

  const ReservationRow = ({ r }: { r: Reservation }) => {
    const a = adById.get(r.ad_id.toString());
    const t = a ? tokenByAddress(a.token) : null;
    const expired = r.status === ReservationStatus.Active && Number(r.lock_expires_at) <= now;
    const claimOpen = r.status === ReservationStatus.Released && r.late_claim_until !== 0n && Number(r.late_claim_until) > now && r.bond_slice > 0n;
    return (
      <li className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <div>
          <p className="font-medium">
            #{r.id.toString()} · {a && t ? `${fmtToken(r.amount, a.decimals)} ${t.symbol}` : "…"} for {fmtTRY(r.try_amount_kurus)}
          </p>
          <p className="text-xs text-muted">
            ad #{r.ad_id.toString()} {a?.nickname ? `(${a.nickname})` : ""} · {r.buyer === address ? "you buy" : `buyer ${short(r.buyer, 4)}`} · {fmtDate(r.created_at)}
            {r.paid_declared_at !== 0n && r.status === ReservationStatus.Active && " · payment declared"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ReservationBadge status={r.status} expired={expired} claimOpen={claimOpen} />
          <Link className="text-sm underline decoration-dotted" href={`/r/${r.id}`}>Open →</Link>
        </div>
      </li>
    );
  };

  return (
    <div className="space-y-8">
      {err && <Alert kind="error">{err}</Alert>}
      <section>
        <h2 className="mb-3 text-lg font-semibold">My purchases</h2>
        {buying.length === 0 ? <Empty title="No reservations yet"><Link className="underline" href="/">Pick an ad in the market</Link>.</Empty> : <ul className="divide-y divide-line rounded-2xl border border-line">{buying.map((r) => <ReservationRow key={r.id.toString()} r={r} />)}</ul>}
      </section>
      <section>
        <h2 className="mb-3 text-lg font-semibold">My ads</h2>
        {myAds.length === 0 ? (
          <Empty title="You have not posted an ad"><Link className="underline" href="/sell">Post one</Link>.</Empty>
        ) : (
          <ul className="divide-y divide-line rounded-2xl border border-line">
            {myAds.map((a) => {
              const t = tokenByAddress(a.token);
              return (
                <li key={a.id.toString()} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <div>
                    <p className="font-medium">
                      #{a.id.toString()} · {t.symbol} at {fmtTRY(a.price_kurus)} · {fmtToken(a.remaining, a.decimals)} free, {fmtToken(a.reserved, a.decimals)} reserved
                    </p>
                    <p className="text-xs text-muted">
                      {a.nickname || "no nickname"} · {a.settled_count} completed · bond {fmtToken(a.bond_available, a.decimals)} free / {fmtToken(a.bond_held, a.decimals)} earmarked
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <AdBadge status={a.status} soldOut={a.status === AdStatus.Active && a.remaining === 0n} />
                    <Link className="text-sm underline decoration-dotted" href={`/ads/${a.id}`}>Manage →</Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {incoming.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Reservations on my ads</h2>
          <ul className="divide-y divide-line rounded-2xl border border-line">{incoming.map((r) => <ReservationRow key={r.id.toString()} r={r} />)}</ul>
        </section>
      )}
    </div>
  );
}
