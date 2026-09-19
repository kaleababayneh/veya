"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { AdStatus } from "@/contracts/escrow";
import { listAds, getConfig, explainError, quoteKurus, tokensForKurus, type Ad, type EscrowConfig } from "@/lib/escrow";
import { fmtToken, fmtTRY, short } from "@/lib/format";
import { TOKENS, tokenByAddress } from "@/lib/tokens";
import { Alert, Button, Empty, Spinner } from "@/components/ui";
import { config, contractUrl } from "@/lib/config";

export default function Market() {
  const [ads, setAds] = useState<Ad[] | null>(null);
  const [cfg, setCfg] = useState<EscrowConfig | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [token, setToken] = useState<string>("all");

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
    const t = setInterval(load, 15_000);
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
          <div className="flex items-center gap-2 text-muted">
            <Spinner /> Loading ads from Soroban RPC…
          </div>
        ) : rows.length === 0 ? (
          <Empty title="No ads with liquidity right now">
            Be the first maker: <Link className="underline" href="/sell">post an ad</Link>.
          </Empty>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-line">
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
        )}
      </section>
    </div>
  );
}
