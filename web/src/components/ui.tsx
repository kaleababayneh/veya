"use client";
import { useI18n } from "@/lib/i18n";
import React from "react";
import Link from "next/link";
import { AdStatus, ReservationStatus } from "@/contracts/escrow";
import { txUrl } from "@/lib/config";
import { ArrowMark } from "@/components/ArrowMark";

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`ui-card p-5 ${className}`}>{children}</div>;
}

export function Button({
  children,
  variant = "primary",
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" }) {
  const v = variant === "primary" ? "btn-primary" : variant === "danger" ? "btn-danger" : "btn-ghost";
  return (
    <button
      {...rest}
      className={`btn inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-50 ${v} ${className}`}
    >
      {children}
    </button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export const inputCls =
  "field-input w-full px-3.5 py-2.5 text-sm";

export function Badge({ tone, children }: { tone: "ok" | "warn" | "accent" | "muted" | "danger"; children: React.ReactNode }) {
  const map = {
    ok: "bg-ok/15 text-ok",
    warn: "bg-warn/15 text-warn",
    accent: "bg-accent/15 text-accent",
    muted: "bg-muted/15 text-muted",
    danger: "bg-danger/15 text-danger",
  }[tone];
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${map}`}>{children}</span>;
}

export function ReservationBadge({ status, expired, claimOpen }: { status: ReservationStatus; expired?: boolean; claimOpen?: boolean }) {
  const { t } = useI18n();
  if (status === ReservationStatus.Active) return <Badge tone={expired ? "danger" : "warn"}>{expired ? t("Reserved · timer ended") : t("Reserved")}</Badge>;
  if (status === ReservationStatus.Settled) return <Badge tone="accent">{t("Completed")}</Badge>;
  return <Badge tone={claimOpen ? "danger" : "muted"}>{claimOpen ? t("Released · bond claim open") : t("Released")}</Badge>;
}

export function AdBadge({ status, soldOut }: { status: AdStatus; soldOut?: boolean }) {
  const { t } = useI18n();
  if (status === AdStatus.Closed) return <Badge tone="muted">{t("Closed")}</Badge>;
  return <Badge tone={soldOut ? "warn" : "ok"}>{soldOut ? t("Fully reserved") : t("Active")}</Badge>;
}

export function Alert({ kind = "info", children }: { kind?: "info" | "warn" | "error" | "ok"; children: React.ReactNode }) {
  const cls = {
    info: "border-accent/30 bg-accent/5",
    warn: "border-warn/40 bg-warn/10",
    error: "border-danger/40 bg-danger/10",
    ok: "border-ok/40 bg-ok/10",
  }[kind];
  return <div role={kind === "error" ? "alert" : "status"} className={`rounded-xl border px-4 py-3 text-sm ${cls}`}>{children}</div>;
}

export function TxLink({ hash, label = "View transaction" }: { hash: string; label?: string }) {
  const {t}=useI18n();
  if (!hash) return null;
  return (
    <a className="underline decoration-dotted underline-offset-4 hover:text-accent" href={txUrl(hash)} target="_blank" rel="noreferrer">
      {t(label)} <ArrowMark />
    </a>
  );
}

/** Grey placeholder blocks while data loads from Soroban RPC. */
export function Skeleton({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  return (
    <div className={`animate-pulse space-y-3 ${className}`} aria-busy="true">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-4 rounded bg-panel-2" style={{ width: `${85 - (i % 3) * 20}%` }} />
      ))}
    </div>
  );
}

export function Spinner() {
  return <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />;
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line p-10 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Steps({ current, steps }: { current: number; steps: string[] }) {
  return (
    <ol className="flex flex-wrap gap-2 text-xs">
      {steps.map((s, i) => (
        <li
          key={s}
          className={`rounded-full border px-3 py-1 ${i < current ? "border-ok/40 text-ok" : i === current ? "border-accent bg-accent/10 text-accent" : "border-line text-muted"}`}
        >
          {i + 1}. {s}
        </li>
      ))}
    </ol>
  );
}

export function BackLink({ href = "/market", children }: { href?: string; children?: React.ReactNode }) {
  const { t } = useI18n();
  const label = children ?? t("← Market");
  return (
    <Link href={href} className="text-sm text-muted hover:text-fg">
      {label}
    </Link>
  );
}
