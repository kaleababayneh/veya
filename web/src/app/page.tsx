"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { AdStatus, ReservationStatus } from "@/contracts/escrow";
import { listAds, listReservations, getConfig, explainError, quoteKurus, tokensForKurus, type Ad, type EscrowConfig, type Reservation } from "@/lib/escrow";
import { fmtToken, fmtTRY, fmtDate, short } from "@/lib/format";
import { TOKENS, tokenByAddress } from "@/lib/tokens";
import { Alert, Button, Empty, Skeleton } from "@/components/ui";
import { config, contractUrl } from "@/lib/config";

export default function Market() {
  const [ads, setAds] = useState<Ad[] | null>(null);
  const [cfg, setCfg] = useState<EscrowConfig | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [token, setToken] = useState<string>("all");
  const [trades, setTrades] = useState<Reservation[] | null>(null);

  useEffect(() => {
    const load = () =>
      listAds().then(
        (list) => {
          setAds(list);
          setErr(null);
        },
        (e) => {
          setErr(explainError(e));
          setAds([]);
        },
      );
    load();
    getConfig().then(setCfg).catch(() => {});
    // settled reservations = completed trades; each one carries a verified proof on-chain
    const loadTrades = () => listReservations(100).then((rs) => setTrades(rs.filter((r) => r.status === ReservationStatus.Settled).slice(0, 6))).catch(() => setTrades([]));
    loadTrades();
    const t = setInterval(() => { load(); loadTrades(); }, 15_000);
    return () => clearInterval(t);
  }, []);

  const tradeable = (a: Ad) => a.status === AdStatus.Active && a.remaining >= tokensForKurus(a.min_try_kurus, a.price_kurus, a.decimals) && a.remaining > 0n;
  const rows = (ads ?? [])
    .filter((a) => tradeable(a) && (token === "all" || a.token === token))
    .sort((x, y) => (x.price_kurus < y.price_kurus ? -1 : x.price_kurus > y.price_kurus ? 1 : 0));

  return (
    <div className="space-y-8">
      <section className="grid gap-6 md:grid-cols-[1.4fr_1fr] md:items-end">
        <div>
          <h1 className="text-4xl font-semibold tracking-tight">Buy XLM or USDC with a Turkish bank transfer. Peer to peer.</h1>
          <p className="mt-3 max-w-xl text-muted">
            Makers post ads with a price and their liquidity in a Soroban escrow. Pick an ad, reserve any amount within its limits, pay the maker by FAST,
            and prove the payment from Ziraat&apos;s own e-dekont e-mail with a zero-knowledge proof. The escrow pays you out in about a minute.
          </p>
          <div className="mt-5 flex gap-3">
            <Link href="/sell">
              <Button>Post an ad</Button>
            </Link>
            <Link href="/how-it-works">
              <Button variant="ghost">How it works</Button>
            </Link>
          </div>
        </div>
        <div className="rounded-2xl border border-line bg-panel p-4 text-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Rules of the market</p>
          <ul className="mt-2 space-y-1.5 text-muted">
            <li>• A reservation holds the maker&apos;s tokens for {cfg ? Number(cfg.lock_duration) / 60 : 60} min at the quoted price.</li>
            <li>• Declare your payment and the maker cannot withdraw for {cfg ? Number(cfg.proof_window) / 60 : 120} min; their {cfg ? Number(cfg.bond_bps) / 100 : 5}% bond backs you after that.</li>
            <li>• Makers&apos; bank details are encrypted on-chain and shown only to you after you reserve.</li>
            <li>• Fee {cfg ? Number(cfg.fee_bps) / 100 : 0.25}% of the tokens you receive. No custody, no middleman.</li>
          </ul>
          {config.escrowId && (
            <a className="mt-3 block text-xs underline decoration-dotted" href={contractUrl(config.escrowId)} target="_blank" rel="noreferrer">
              Escrow contract on stellar.expert ↗
            </a>
          )}
          <p className="mt-2 text-xs text-muted">
            Testnet: fund a wallet at <a className="underline decoration-dotted" href="https://lab.stellar.org/account/fund?$=network$id=testnet" target="_blank" rel="noreferrer">Stellar Lab (Friendbot)</a>. Paying by FAST needs a Ziraat account; without one, browse the market and open a recent trade to see a settled proof.
          </p>
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Buy</h2>
          <div className="flex gap-1 rounded-xl border border-line p-1 text-xs">
            {[{ address: "all", symbol: "All" }, ...TOKENS].map((t) => (
              <button key={t.address} onClick={() => setToken(t.address)} className={`rounded-lg px-3 py-1 ${token === t.address ? "bg-panel-2 font-semibold" : "text-muted"}`}>
                {t.symbol}
              </button>
            ))}
          </div>
        </div>
        {err && <Alert kind="error">{err}</Alert>}
        {!config.escrowId && <Alert kind="warn">Escrow contract id is not configured (NEXT_PUBLIC_ESCROW_ID).</Alert>}
        {ads === null ? (
          <div className="rounded-2xl border border-line p-5"><Skeleton lines={4} /></div>
        ) : rows.length === 0 ? (
          <Empty title="No ads with liquidity right now">
            Be the first maker: <Link className="underline" href="/sell">post an ad</Link>.
          </Empty>
        ) : (
          <>
            {/* phones: one card per ad */}
            <ul className="space-y-3 sm:hidden">
              {rows.map((a) => {
                const t = tokenByAddress(a.token);
                return (
                  <li key={a.id.toString()} className="rounded-2xl border border-line bg-panel p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">{a.nickname || short(a.seller, 5)}</p>
                        <p className="text-xs text-muted">{a.settled_count} trades · {a.active_reservations} active</p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-semibold">{fmtTRY(a.price_kurus)}</p>
                        <p className="text-xs text-muted">per {t.symbol}</p>
                      </div>
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                      <div><dt className="text-xs text-muted">Available</dt><dd>{fmtToken(a.remaining, a.decimals)} {t.symbol}</dd></div>
                      <div><dt className="text-xs text-muted">Per trade</dt><dd>{fmtTRY(a.min_try_kurus)} – {fmtTRY(a.max_try_kurus)}</dd></div>
                    </dl>
                    <Link href={`/ads/${a.id}`} className="mt-3 block">
                      <Button className="w-full">Buy {t.symbol}</Button>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <div className="hidden overflow-x-auto rounded-2xl border border-line sm:block">
            <table className="w-full text-sm">
              <thead className="bg-panel-2 text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-3">Maker</th>
                  <th className="px-4 py-3">Price</th>
                  <th className="px-4 py-3">Available</th>
                  <th className="px-4 py-3">Limits</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => {
                  const t = tokenByAddress(a.token);
                  return (
                    <tr key={a.id.toString()} className="border-t border-line hover:bg-panel-2/60">
                      <td className="px-4 py-3">
                        <p className="font-medium">{a.nickname || short(a.seller, 5)}</p>
                        <p className="text-xs text-muted">
                          {a.settled_count} trades · {a.active_reservations} active · <span className="mono">{short(a.seller, 4)}</span>
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-base font-semibold">{fmtTRY(a.price_kurus)}</p>
                        <p className="text-xs text-muted">per {t.symbol}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium">{fmtToken(a.remaining, a.decimals)} {t.symbol}</p>
                        <p className="text-xs text-muted">≈ {fmtTRY(quoteKurus(a.remaining, a.price_kurus, a.decimals))}</p>
                      </td>
                      <td className="px-4 py-3 text-muted">
                        {fmtTRY(a.min_try_kurus)} – {fmtTRY(a.max_try_kurus)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link href={`/ads/${a.id}`}>
                          <Button>Buy {t.symbol}</Button>
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </section>

      {/* completed trades: for visitors who cannot pay by FAST themselves, this is the proof that the loop closes */}
      {trades && trades.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <h2 className="text-xl font-semibold">Recent trades</h2>
            <p className="text-xs text-muted">Each settled with a zero-knowledge proof of the bank transfer, verified on-chain.</p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {trades.map((r) => {
              const ad = (ads ?? []).find((a) => a.id === r.ad_id);
              const t = ad ? tokenByAddress(ad.token) : null;
              return (
                <li key={r.id.toString()}>
                  <Link href={`/r/${r.id}`} className="block rounded-2xl border border-line bg-panel p-4 hover:bg-panel-2/60">
                    <p className="font-semibold">{fmtTRY(r.try_amount_kurus)} → {ad && t ? `${fmtToken(r.amount, ad.decimals)} ${t.symbol}` : "…"}</p>
                    <p className="mt-1 text-xs text-muted">
                      {ad?.nickname || (ad ? short(ad.seller, 4) : "maker")} → <span className="mono">{short(r.buyer, 4)}</span> · settled {fmtDate(r.settled_at)}
                    </p>
                    <p className="mt-2 text-xs text-accent">View the trade →</p>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
