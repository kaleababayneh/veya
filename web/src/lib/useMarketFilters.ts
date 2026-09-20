"use client";
import { useSyncExternalStore } from "react";
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
  let values = { amount: "", asset: "all", bank: "" };
  try {
    values = { ...values, ...JSON.parse(raw) };
  } catch {}
  const set = (field: keyof typeof values | "reset", value: string) => {
    fallback = JSON.stringify(
      field === "reset"
        ? { amount: "", asset: "all", bank: values.bank }
        : { ...values, [field]: value },
    );
    try {
      sessionStorage.setItem(key, fallback);
    } catch {}
    window.dispatchEvent(new Event(event));
  };
  return { ...values, set };
}
