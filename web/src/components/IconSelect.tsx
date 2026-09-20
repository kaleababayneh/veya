"use client";
/** Custom dropdown with an icon per option (token logos, bank logos); options can be disabled with a tag. */
import { useEffect, useRef, useState } from "react";

/** `wide`: the icon is a wordmark that already carries the name — show it large and hide the text label. */
export type IconOption = { value: string; label: string; icon?: string | null; iconAlt?: string; disabled?: boolean; tag?: string; monogram?: { text: string; color: string }; wide?: boolean };

export function OptionIcon({ o, size = 22 }: { o: IconOption; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (o.wide && o.icon && !failed) {
    return (
      <span className="icon-select-wide">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={o.icon} alt={o.label} onError={() => setFailed(true)} />
      </span>
    );
  }
  if (o.wide && (failed || !o.icon)) {
    return (
      <span className="inline-flex items-center gap-2">
        {o.monogram && (
          <span aria-hidden className="inline-grid shrink-0 place-items-center rounded-full font-bold text-white" style={{ width: size, height: size, background: o.monogram.color, fontSize: Math.round(size * 0.42) }}>
            {o.monogram.text}
          </span>
        )}
        <span>{o.label}</span>
      </span>
    );
  }
  if (o.icon && !failed) {
    return (
      <span aria-hidden className="inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-white ring-1 ring-black/10" style={{ width: size, height: size, padding: Math.max(2, Math.round(size * 0.14)) }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={o.icon} alt="" className="h-full w-full object-contain" onError={() => setFailed(true)} />
      </span>
    );
  }
  if (o.monogram) {
    return (
      <span aria-hidden className="inline-grid shrink-0 place-items-center rounded-full font-bold text-white" style={{ width: size, height: size, background: o.monogram.color, fontSize: Math.round(size * 0.42) }}>
        {o.monogram.text}
      </span>
    );
  }
  return <span aria-hidden className="inline-block shrink-0 rounded-full border border-dashed border-line" style={{ width: size, height: size }} />;
}

export function IconSelect({ value, options, onChange, placeholder, className = "", ariaLabel }: { value: string; options: IconOption[]; onChange: (v: string) => void; placeholder?: string; className?: string; ariaLabel?: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value) ?? null;

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
    <div ref={box} className={`icon-select ${className}`}>
      <button type="button" aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel} className="icon-select-button" onClick={(e) => { e.preventDefault(); setOpen((o) => !o); }}>
        <span className="icon-select-value">
          {selected ? <OptionIcon o={selected} /> : null}
          {selected?.wide ? <span className="sr-only">{selected.label}</span> : <span className={selected ? "" : "text-muted"}>{selected ? selected.label : placeholder ?? "Select…"}</span>}
        </span>
        <span aria-hidden className="icon-select-chevron">⌄</span>
      </button>
      {open && (
        <ul role="listbox" className="icon-select-menu">
          {options.map((o) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              aria-disabled={!!o.disabled}
              className={`icon-select-option ${o.disabled ? "is-disabled" : o.value === value ? "is-selected" : ""}`}
              onClick={(e) => {
                e.preventDefault();
                if (o.disabled) return;
                onChange(o.value);
                setOpen(false);
              }}
            >
              <span className="icon-select-value">
                <OptionIcon o={o} />
                {o.wide ? <span className="sr-only">{o.label}</span> : o.label}
              </span>
              {o.tag && <span className="icon-select-tag">{o.tag}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
