"use client";
import { useEffect, useRef, useState } from "react";
/** Single in-flight read, no late updates after unmount; refresh on return, back off on failure. */
export function useRefresh<T>(load: () => Promise<T>, interval = 15000) {
  const [state, setState] = useState<{
    data: T | null;
    error: string | null;
    updated: number;
    source: typeof load;
  }>({ data: null, error: null, updated: 0, source: load });
  const trigger = useRef<() => void>(() => {});
  useEffect(() => {
    let alive = true,
      running = false,
      failures = 0;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      if (!alive || running) return;
      clearTimeout(timer);
      running = true;
      try {
        const data = await load();
        if (alive) {
          failures = 0;
          setState({ data, error: null, updated: Date.now(), source: load });
        }
      } catch (e) {
        if (alive) {
          failures++;
          setState((s) => ({
            ...s,
            data: s.source === load ? s.data : null,
            source: load,
            error: e instanceof Error ? e.message : String(e),
          }));
        }
      } finally {
        running = false;
        if (alive)
          timer = setTimeout(
            refresh,
            Math.min(interval * 2 ** failures, 120000),
          );
      }
    };
    const resume = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    trigger.current = () => void refresh();
    void refresh();
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      alive = false;
      clearTimeout(timer);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [load, interval]);
  return {
    ...state,
    data: state.source === load ? state.data : null,
    error: state.source === load ? state.error : null,
    refresh: () => trigger.current(),
  };
}
