"use client";
/** Bank picker with a monogram badge per bank; unsupported banks are greyed out with a "soon" tag. */
import { useEffect, useRef, useState } from "react";
import { BANKS, type Bank } from "@/lib/banks";

export function BankLogo({ bank, size = 24 }: { bank: Bank; size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-grid shrink-0 place-items-center rounded-full font-bold text-white"
      style={{ width: size, height: size, background: bank.color, fontSize: Math.round(size * 0.42), letterSpacing: "-0.02em" }}
    >
      {bank.initials}
    </span>
  );
}

export function BankSelect({ value, onChange, className = "" }: { value: string; onChange: (code: string) => void; className?: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const selected = BANKS.find((b) => b.code === value) ?? null;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={box} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 rounded-xl border border-line bg-panel px-3 py-2.5 text-left text-sm hover:border-accent/60"
      >
        <span className="flex items-center gap-2">
          {selected ? <BankLogo bank={selected} /> : <span className="inline-block h-6 w-6 rounded-full border border-dashed border-line" />}
          <span className={selected ? "" : "text-muted"}>{selected ? selected.name : "Select your bank…"}</span>
        </span>
        <span className="text-muted">▾</span>
      </button>
      {open && (
        <ul role="listbox" className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-line bg-panel p-1 shadow-lg">
          {BANKS.map((b) => (
            <li
              key={b.code}
              role="option"
              aria-selected={b.code === value}
              aria-disabled={!b.supported}
              onClick={() => {
                if (!b.supported) return;
                onChange(b.code);
                setOpen(false);
              }}
              className={`flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-sm ${
                !b.supported ? "cursor-not-allowed opacity-45" : b.code === value ? "cursor-pointer bg-accent/10 font-medium" : "cursor-pointer hover:bg-panel-2"
              }`}
            >
              <span className="flex items-center gap-2">
                <BankLogo bank={b} />
                {b.name}
              </span>
              {!b.supported && <span className="rounded-md border border-line px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted">soon</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
