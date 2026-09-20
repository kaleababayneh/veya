"use client";
import { useNow } from "@/lib/useNow";
import { useCallback, useState } from "react";
import Link from "next/link";
import { useWallet } from "@/lib/wallet";
import { listAds, listReservations, getConfig } from "@/lib/escrow";
import { useRefresh } from "@/lib/useRefresh";
import { tradeAction, netReceipt, validId } from "@/lib/ux";
import { fmtToken, fmtTRY, fmtDate } from "@/lib/format";
import { tokenByAddress } from "@/lib/tokens";
import {
  Alert,
  Button,
  Empty,
  Skeleton,
  ReservationBadge,
  AdBadge,
} from "@/components/ui";
import { PageHeading, useCopy, FundingLink } from "@/components/Product";
export default function Activity() {
  const { address } = useWallet();
  return <ActivityForWallet key={address ?? "disconnected"} />;
}
function ActivityForWallet() {
  const [olderId, setOlderId] = useState("");
  const { address, connect, connecting, ready } = useWallet(),
    c = useCopy();
  const load = useCallback(async () => {
    if (!address) return { ads: [], reservations: [], cfg: null };
    const [ads, reservations, cfg] = await Promise.all([
      listAds(),
      listReservations(),
      getConfig(),
    ]);
    return { ads, reservations, cfg };
  }, [address]);
  const { data, error, refresh } = useRefresh(load);
  const now = useNow(),
    ads = data?.ads ?? [],
    all = data?.reservations ?? [];
  const buying = all
    .filter((r) => r.buyer === address)
    .sort(
      (a, b) =>
        Number(tradeAction(a, now) === "view") -
          Number(tradeAction(b, now) === "view") ||
        Number(b.created_at - a.created_at),
    );
  const mine = ads.filter((a) => a.seller === address),
    ids = new Set(mine.map((a) => String(a.id)));
  const incoming = all.filter((r) => ids.has(String(r.ad_id)));
  const labels = {
    pay: c("Continue payment", "Ödemeye devam et"),
    verify: c("Verify receipt", "Dekontu doğrula"),
    expired: c("Review expired trade", "Süresi dolan işlemi incele"),
    bond: c("Review bond claim", "Teminat talebini incele"),
    view: c("View trade", "İşlemi görüntüle"),
  };
  const rows = (list: typeof buying) => (
    <div className="activity-list">
      {list.map((r) => {
        const a = ads.find((a) => a.id === r.ad_id),
          t = a ? tokenByAddress(a.token) : null;
        return (
          <article className="activity-row" key={String(r.id)}>
            <div>
              <p className="product-eyebrow">
                {c("TRADE", "İŞLEM")} #{String(r.id)}
              </p>
              <h3>
                {fmtTRY(r.try_amount_kurus)} →{" "}
                {a && t
                  ? `${fmtToken(r.status === 1 ? r.amount : netReceipt(r.amount, Number(data?.cfg?.fee_bps ?? 0)), a.decimals)} ${t.symbol}`
                  : "…"}
              </h3>
              <p className="text-sm text-muted">
                {r.status === 1 && c("Before fee · ", "Ücret öncesi · ")}
                {fmtDate(r.created_at)} · {a?.nickname}
              </p>
            </div>
            <ReservationBadge
              status={r.status}
              expired={r.status === 0 && Number(r.lock_expires_at) <= now}
              claimOpen={tradeAction(r, now) === "bond"}
            />
            <Link className="product-text-link" href={`/r/${r.id}`}>
              {r.buyer === address
                ? labels[tradeAction(r, now)]
                : c("Review trade", "İşlemi incele")}{" "}
              ↗
            </Link>
          </article>
        );
      })}
    </div>
  );
  return (
    <div className="product-page">
      <PageHeading
        eyebrow={c("YOUR ACTIVITY", "İŞLEMLERİNİZ")}
        title={c(
          "Pick up where you left off.",
          "Kaldığınız yerden devam edin.",
        )}
        description={c(
          "Your purchases, offers and next steps in one place.",
          "Alımlarınız, teklifleriniz ve sonraki adımlarınız bir arada.",
        )}
        action={
          address ? (
            <button className="product-text-link" onClick={refresh}>
              {c("Refresh", "Yenile")} ↻
            </button>
          ) : undefined
        }
      />
      {!address ? (
        <Empty
          title={c("Your wallet is your account", "Cüzdanınız hesabınızdır")}
        >
          <p className="mb-4">
            {c(
              "Connect the wallet you used for your trade.",
              "İşleminizde kullandığınız cüzdanı bağlayın.",
            )}
          </p>
          <Button onClick={connect} disabled={!ready || connecting}>
            {c("Connect wallet", "Cüzdanı bağla")}
          </Button>
        </Empty>
      ) : (
        <>
          {error && (
            <Alert kind="error">
              {c(
                "Activity could not be refreshed. Try again.",
                "İşlemler yenilenemedi. Tekrar deneyin.",
              )}{" "}
              <button onClick={refresh} className="underline">
                {c("Retry", "Tekrar dene")}
              </button>
            </Alert>
          )}
          {!data && !error ? (
            <Skeleton lines={5} />
          ) : (
            <>
              <h2 className="section-title">
                {c("Your purchases", "Alımlarınız")}
              </h2>
              {buying.length ? (
                rows(buying)
              ) : (
                <Empty
                  title={c(
                    "Your first trade starts here",
                    "İlk işleminiz burada başlıyor",
                  )}
                >
                  <Link className="product-text-link" href="/market">
                    {c("Explore offers", "Teklifleri keşfet")} ↗
                  </Link>
                </Empty>
              )}
              <div className="section-heading">
                <h2>{c("Your offers", "Teklifleriniz")}</h2>
                <FundingLink />
              </div>
              {mine.length ? (
                <div className="activity-list">
                  {mine.map((a) => (
                    <article className="activity-row" key={String(a.id)}>
                      <div>
                        <h3>
                          {tokenByAddress(a.token).symbol} ·{" "}
                          {fmtTRY(a.price_kurus)}
                        </h3>
                        <p>
                          {fmtToken(a.remaining, a.decimals)}{" "}
                          {c("available", "mevcut")} · {a.settled_count}{" "}
                          {c("completed trades", "tamamlanan işlem")}
                        </p>
                      </div>
                      <AdBadge status={a.status} soldOut={a.remaining === 0n} />
                      <Link className="product-text-link" href={`/ads/${a.id}`}>
                        {c("Manage offer", "Teklifi yönet")} ↗
                      </Link>
                    </article>
                  ))}
                </div>
              ) : (
                <Link className="product-text-link" href="/sell">
                  {c("Create an offer", "Teklif oluştur")} ↗
                </Link>
              )}
              {incoming.length > 0 && (
                <>
                  <h2 className="section-title">
                    {c("Buyers on your offers", "Tekliflerinizdeki alıcılar")}
                  </h2>
                  {rows(incoming)}
                </>
              )}
            </>
          )}
        </>
      )}
      {address && (
        <details className="rounded-xl border border-line p-4">
          <summary>{c("Find an older trade", "Eski bir işlemi bul")}</summary>
          <p className="text-sm text-muted my-3">
            {c(
              "Activity covers the latest 200 market reservations. Open an older trade using its number or your saved link.",
              "İşlemler son 200 piyasa rezervasyonunu kapsar. Eski bir işlemi numarasıyla veya kaydettiğiniz bağlantıyla açın.",
            )}
          </p>
          <label className="block">
            {c("Trade number", "İşlem numarası")}
            <input
              className="block border border-line rounded-lg p-2 my-2"
              inputMode="numeric"
              value={olderId}
              onChange={(e) => setOlderId(e.target.value)}
            />
          </label>
          {validId(olderId) !== null && (
            <Link className="product-text-link" href={`/r/${olderId}`}>
              {c("Open trade", "İşlemi aç")} ↗
            </Link>
          )}
        </details>
      )}
    </div>
  );
}
