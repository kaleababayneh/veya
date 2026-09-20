"use client";
/** Bank picker with a monogram badge per bank; unsupported banks are greyed out with a "soon" tag. */
import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { BANKS, type Bank } from "@/lib/banks";
import { IconSelect } from "./IconSelect";

export function BankLogo({ bank, size = 24 }: { bank: Bank; size?: number }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span
        aria-hidden
        className="inline-grid shrink-0 place-items-center rounded-full font-bold text-white"
        style={{
          width: size,
          height: size,
          background: bank.color,
          fontSize: Math.round(size * 0.42),
          letterSpacing: "-0.02em",
        }}
      >
        {bank.initials}
      </span>
    );
  }

  return (
    <span
      aria-hidden
      className="inline-grid shrink-0 place-items-center overflow-hidden rounded-md bg-white ring-1 ring-black/10"
      style={{
        width: size * 1.75,
        height: size,
        padding: Math.max(1, Math.round(size * 0.1)),
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={bank.logo}
        alt=""
        className="h-full w-full object-contain"
        onError={() => setFailed(true)}
      />
    </span>
  );
}

export function BankSelect({
  value,
  onChange,
  className = "",
}: {
  value: string;
  onChange: (code: string) => void;
  className?: string;
}) {
  const { lang } = useI18n();
  return (
    <IconSelect
      className={className}
      value={value}
      onChange={onChange}
      placeholder={lang === "tr" ? "Bankanızı seçin…" : "Select your bank…"}
      options={BANKS.map((b) => ({
        value: b.code,
        label: b.name,
        icon: b.logo,
        monogram: { text: b.initials, color: b.color },
        wide: true,
        disabled: !b.supported,
        tag: b.supported ? undefined : lang === "tr" ? "yakında" : "soon",
      }))}
    />
  );
}
