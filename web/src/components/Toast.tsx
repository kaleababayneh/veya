"use client";
/** Small toast stack for transaction results and wallet events; errors that need reading stay inline as Alerts. */
import React, { createContext, useCallback, useContext, useState } from "react";

type Toast = { id: number; kind: "ok" | "error" | "info"; title: string; body?: React.ReactNode; ttl: number };
type ToastCtx = { toast: (t: Omit<Toast, "id" | "ttl"> & { ttl?: number }) => void };

const Ctx = createContext<ToastCtx>({ toast: () => {} });
let seq = 1;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const toast = useCallback<ToastCtx["toast"]>((t) => {
    const id = seq++;
    const ttl = t.ttl ?? (t.kind === "error" ? 9000 : 6000);
    setItems((xs) => [...xs, { ...t, id, ttl }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), ttl);
  }, []);
  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6" aria-live="polite">
        {items.map((t) => (
          <div
            key={t.id}
            className={`app-toast pointer-events-auto w-full max-w-sm px-4 py-3 text-sm ${t.kind === "ok" ? "is-ok" : t.kind === "error" ? "is-error" : ""}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">{t.title}</p>
                {t.body && <div className="mt-0.5 text-xs text-muted">{t.body}</div>}
              </div>
              <button className="text-xs text-muted" onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))} aria-label="dismiss">✕</button>
            </div>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
