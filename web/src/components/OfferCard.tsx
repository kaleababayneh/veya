"use client";
import Link from "next/link";
import type { Offer } from "@/contracts/escrow";
import { OfferStatus } from "@/contracts/escrow";
import { fmtToken, fmtTRY, nowSec, short } from "@/lib/format";
import { tokenByAddress } from "@/lib/tokens";
import { StatusBadge } from "./ui";

export function OfferCard({ offer }: { offer: Offer }) {
  const t = tokenByAddress(offer.token);
  const price = Number(offer.try_amount_kurus) / 100 / (Number(offer.amount) / 10 ** t.decimals);
  const expired = offer.status === OfferStatus.Locked && Number(offer.lock_expires_at) <= nowSec();
  return (
    <Link href={`/offers/${offer.id}`} className="group block rounded-2xl border border-line bg-panel p-5 transition hover:border-accent/60 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs text-muted">Offer #{offer.id.toString()} · seller {short(offer.seller)}</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight">
            {fmtToken(offer.amount, t.decimals)} <span className="text-base font-medium text-muted">{t.symbol}</span>
          </p>
        </div>
        <StatusBadge status={offer.status} expired={expired} />
      </div>
      <div className="mt-4 flex items-end justify-between">
        <div>
          <p className="text-xs text-muted">You pay by FAST</p>
          <p className="text-lg font-semibold">{fmtTRY(offer.try_amount_kurus)}</p>
        </div>
        <p className="text-xs text-muted">
          ≈ {price.toLocaleString("tr-TR", { maximumFractionDigits: 2 })} ₺ / {t.symbol}
        </p>
      </div>
    </Link>
  );
}
