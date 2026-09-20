"use client";
import { useSyncExternalStore } from "react";
import { TOKENS } from "./tokens";
/** XLM when configured; "all" in environments without token addresses (tests) */
const DEFAULT_ASSET = TOKENS[0]?.address ?? "all";
let fallback = "";
const key = "veya-market-filters",
  event = "veya-market-filters-changed";
const subscribe = (fn: () => void) => {
  window.addEventListener(event, fn);
  return () => window.removeEventListener(event, fn);
};
const snapshot = () => {
  try {
    return sessionStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};
const server = () => "";
export function useMarketFilters() {
  const raw = useSyncExternalStore(subscribe, snapshot, server);
  // XLM is the default asset; an old stored "all" (from before the asset switch) maps to XLM too
  let values = { amount: "", asset: DEFAULT_ASSET, bank: "" };
  try {
    values = { ...values, ...JSON.parse(raw) };
  } catch {}
  if (!values.asset || values.asset === "all") values.asset = DEFAULT_ASSET;
  const set = (field: keyof typeof values | "reset", value: string) => {
    fallback = JSON.stringify(
      field === "reset"
        ? { amount: "", asset: DEFAULT_ASSET, bank: values.bank }
        : { ...values, [field]: value },
    );
    try {
      sessionStorage.setItem(key, fallback);
    } catch {}
    window.dispatchEvent(new Event(event));
  };
  return { ...values, set };
}
