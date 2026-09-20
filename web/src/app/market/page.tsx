"use client";
import { useMarketFilters } from "@/lib/useMarketFilters";
import { useNow } from "@/lib/useNow";
import { useCallback } from "react";
import Link from "next/link";
import { listAds, listReservations, getConfig, quoteKurus, tokensForKurus } from "@/lib/escrow";
import { ReservationStatus } from "@/contracts/escrow";
import { parseTRY, fmtTRY, fmtToken, fmtDate, short } from "@/lib/format";
import { TOKENS, tokenByAddress } from "@/lib/tokens";
import { availableOffer, netReceipt } from "@/lib/ux";
import { useRefresh } from "@/lib/useRefresh";
import {
  Alert,
  Button,
  Empty,
  Field,
  Skeleton,
} from "@/components/ui";
import { IconSelect } from "@/components/IconSelect";
import { BANKS } from "@/lib/banks";
import { PageHeading, useCopy } from "@/components/Product";
export default function Market() {
  const c = useCopy();
  const { amount, asset, bank, set } = useMarketFilters();
  const setAmount = (v: string) => set("amount", v),
    setAsset = (v: string) => set("asset", v),
    setBank = (v: string) => set("bank", v);
  const load = useCallback(async () => {
    const [ads, cfg, reservations] = await Promise.all([listAds(), getConfig(), listReservations(100)]);
    return { ads, cfg, reservations };
  }, []);
  const { data, error, refresh, updated } = useRefresh(load);
  let kurus = 0n,
    invalid = false;
  try {
    kurus = amount ? parseTRY(amount) : 0n;
    invalid = !!amount && kurus <= 0n;
  } catch {
    invalid = true;
  }
  const now = useNow();
  const rows = (data?.ads ?? [])
    .filter(
      (a) =>
        availableOffer(a, now, kurus) && (asset === "all" || a.token === asset),
    )
    .sort((a, b) =>
      a.price_kurus < b.price_kurus
        ? -1
        : a.price_kurus > b.price_kurus
          ? 1
          : 0,
    );
  // completed trades: each one settled on a verified proof of the bank transfer
  const trades = (data?.reservations ?? [])
    .filter((r) => r.status === ReservationStatus.Settled)
    .slice(0, 6)
    .map((r) => ({ r, ad: (data?.ads ?? []).find((a) => a.id === r.ad_id) }));
  const href = (id: bigint) =>
    `/ads/${id}?amount=${encodeURIComponent(amount)}&bank=${encodeURIComponent(bank)}`;
  return (
    <div className="product-page">
      <PageHeading
        eyebrow={c("PEER TO PEER", "KİŞİDEN KİŞİYE")}
        title={c("Your next move.", "Bir sonraki adımınız.")}
        description={c(
          "Choose an amount. Find an offer. Pay from your bank.",
          "Tutarı seçin. Teklif bulun. Bankanızdan ödeyin.",
        )}
        action={
          <Link href="/sell" className="product-text-link">
            {c("Want to sell?", "Satmak mı istiyorsunuz?")} ↗
          </Link>
        }
      />
      <section
        className="buy-search"
        aria-label={c("Find an offer", "Teklif bul")}
      >
        <Field label={c("I want to spend", "Ödemek istediğim tutar")}>
          <div className="amount-input">
            <span>₺</span>
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="1.000,00"
              aria-label={c("Amount in Turkish lira", "Türk lirası tutarı")}
            />
          </div>
        </Field>
        <Field label={c("Receive", "Alacağınız varlık")}>
          <IconSelect
            ariaLabel={c("Asset to receive", "Alınacak varlık")}
            value={asset}
            onChange={setAsset}
            options={[
              { value: "all", label: c("All assets", "Tüm varlıklar"), monogram: { text: "∗", color: "#6c6570" } },
              ...TOKENS.map((t) => ({ value: t.address, label: t.symbol, icon: `/tokens/${t.symbol.toLowerCase()}.svg` })),
            ]}
          />
        </Field>
        <Field label={c("Paying from", "Ödeme bankanız")}>
          <IconSelect
            ariaLabel={c("Bank you pay from", "Ödeme yapacağınız banka")}
            value={bank}
            onChange={setBank}
            placeholder={c("Choose your bank", "Bankanızı seçin")}
            options={[
              ...BANKS.filter((b) => b.supported).map((b) => ({ value: b.code === "00010" ? "ziraat" : "vakif", label: b.name, icon: b.logo, monogram: { text: b.initials, color: b.color } })),
              ...BANKS.filter((b) => !b.supported).map((b) => ({ value: `soon-${b.code}`, label: b.name, icon: b.logo, monogram: { text: b.initials, color: b.color }, disabled: true, tag: c("soon", "yakında") })),
              { value: "other", label: c("Another bank", "Başka banka"), monogram: { text: "?", color: "#6c6570" } },
            ]}
          />
        </Field>
      </section>
      <div className="product-notice">
        {c(
          "Test tokens, real bank transfers. You need the original receipt email to complete a purchase.",
          "Test tokenları, gerçek banka transferleri. Alımı tamamlamak için orijinal dekont e-postası gerekir.",
        )}{" "}
        <Link href="/how-it-works">
          {c("See the steps", "Adımları görün")} ↗
        </Link>
      </div>
      {invalid && (
        <Alert kind="warn">
          {c(
            "Enter a positive TRY amount, such as 1.000,00.",
            "1.000,00 gibi pozitif bir TL tutarı girin.",
          )}
        </Alert>
      )}
      {bank === "other" && (
        <Alert kind="warn">
          {c(
            "Receipt verification currently supports Ziraat and VakıfBank. You can browse, but do not reserve or pay from another bank.",
            "Dekont doğrulaması şu anda Ziraat ve VakıfBank için destekleniyor. Tekliflere bakabilirsiniz; başka bankadan ödeme yapmak için rezervasyon oluşturmayın.",
          )}
        </Alert>
      )}
      <div className="section-heading">
        <h2>
          {c("Available offers", "Uygun teklifler")}{" "}
          {data && !invalid && <span>{rows.length}</span>}
        </h2>
        <button onClick={refresh} className="product-text-link">
          {c("Refresh", "Yenile")} ↻
        </button>
      </div>
      {error && (
        <Alert kind="error">
          {c(
            "Offers could not be refreshed. Do not rely on an old quote.",
            "Teklifler yenilenemedi. Eski bir fiyata güvenmeyin.",
          )}{" "}
        </Alert>
      )}
      {!data && !error ? (
        <Skeleton lines={5} />
      ) : !invalid && rows.length === 0 ? (
        <Empty
          title={c("No matching offers right now", "Şu anda uygun teklif yok")}
        >
          {c(
            "Try another amount or asset, or browse all offers.",
            "Başka tutar veya varlık deneyin ya da tüm tekliflere bakın.",
          )}
          <div className="mt-4">
            <Button
              variant="ghost"
              onClick={() => {
                set("reset", "");
              }}
            >
              {c("Browse all offers", "Tüm teklifleri göster")}
            </Button>
          </div>
        </Empty>
      ) : (
        !invalid && (
          <div className="offer-list">
            {rows.map((a) => {
              const t = tokenByAddress(a.token);
              const gross = kurus
                ? tokensForKurus(kurus, a.price_kurus, a.decimals)
                : 0n;
              return (
                <article key={String(a.id)} className="offer-row">
                  <div className="seller-identity">
                    <span className="seller-initial" aria-hidden="true">
                      {(a.nickname || "V").slice(0, 1).toUpperCase()}
                    </span>
                    <div>
                      <h3>{a.nickname || short(a.seller, 5)}</h3>
                      <p>
                        {a.settled_count}{" "}
                        {c("completed trades", "tamamlanan işlem")}
                      </p>
                    </div>
                  </div>
                  <div>
                    <span className="offer-label">
                      {gross
                        ? c(
                            "You receive after fees",
                            "Ücret sonrası alacağınız",
                          )
                        : c("Price per token", "Token başına fiyat")}
                    </span>
                    <strong>
                      {gross
                        ? `${fmtToken(netReceipt(gross, Number(data!.cfg.fee_bps)), a.decimals)} ${t.symbol}`
                        : fmtTRY(a.price_kurus)}
                    </strong>
                    <p>
                      {gross
                        ? `${c("You pay", "Ödeyeceğiniz")} ${fmtTRY(quoteKurus(gross, a.price_kurus, a.decimals))}`
                        : t.symbol}
                    </p>
                  </div>
                  <div className="offer-limits">
                    <span className="offer-label">
                      {c("Trade limits", "İşlem sınırları")}
                    </span>
                    <p>
                      {fmtTRY(a.min_try_kurus)} – {fmtTRY(a.max_try_kurus)}
                    </p>
                    <p>
                      {fmtToken(a.remaining, a.decimals)} {t.symbol}{" "}
                      {c("available", "mevcut")}
                    </p>
                  </div>
                  {bank === "other" || error ? (
                    <span className="text-sm text-muted">
                      {c("Unavailable", "Kullanılamıyor")}
                    </span>
                  ) : (
                    <Link className="offer-cta" href={href(a.id)}>
                      {c("Buy", "Al")} {t.symbol} ↗
                    </Link>
                  )}
                </article>
              );
            })}
          </div>
        )
      )}
      {updated > 0 && (
        <p className="text-xs text-muted">
          {c("Updated", "Güncellendi")}:{" "}
          {new Date(updated).toLocaleTimeString()} ·{" "}
          {c(
            "Final price is checked before reservation.",
            "Kesin fiyat rezervasyondan önce kontrol edilir.",
          )}
        </p>
      )}
      {trades.length > 0 && (
        <>
          <div className="section-heading">
            <h2>
              {c("Recent trades", "Son işlemler")} <span>{trades.length}</span>
            </h2>
            <span className="text-sm text-muted">
              {c(
                "Each settled with a zero-knowledge proof of the bank transfer, verified on-chain.",
                "Her biri banka transferinin sıfır bilgi ispatıyla, zincir üzerinde doğrulanarak tamamlandı.",
              )}
            </span>
          </div>
          <div className="trade-strip" role="list">
            {trades.map(({ r, ad }) => {
              const t = ad ? tokenByAddress(ad.token) : null;
              const fee = data ? (r.amount * BigInt(Number(data.cfg.fee_bps))) / 10000n : 0n;
              return (
                <Link key={String(r.id)} href={`/r/${r.id}`} className="trade-card" role="listitem">
                  <strong>
                    {fmtTRY(r.try_amount_kurus)} → {ad && t ? `${fmtToken(r.amount - fee, ad.decimals)} ${t.symbol}` : "…"}
                  </strong>
                  <p>
                    {ad?.nickname || (ad ? short(ad.seller, 4) : c("maker", "satıcı"))} → <span className="mono">{short(r.buyer, 4)}</span> · {c("settled", "tamamlandı")} {fmtDate(r.settled_at)}
                  </p>
                  <span className="trade-card-link">{c("View the trade", "İşlemi gör")} →</span>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
