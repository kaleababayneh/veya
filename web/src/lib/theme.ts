"use client";
/**
 * Light/dark theme, driven by `data-theme` on <html> (set before first paint by THEME_BOOT_SCRIPT).
 * Light is the default; with no stored choice the app follows the system setting.
 */
import { useSyncExternalStore } from "react";
import { THEME_KEY } from "./theme-boot";

export type Theme = "light" | "dark";

const listeners = new Set<() => void>();
const current = (): Theme => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");

function stored(): Theme | null {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === "light" || t === "dark" ? t : null;
  } catch {
    return null;
  }
}

export function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* private mode: the choice lasts for this page only */
  }
  listeners.forEach((l) => l());
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  const onSystem = (e: MediaQueryListEvent) => {
    if (stored()) return;
    document.documentElement.dataset.theme = e.matches ? "dark" : "light";
    onChange();
  };
  media?.addEventListener("change", onSystem);
  return () => {
    listeners.delete(onChange);
    media?.removeEventListener("change", onSystem);
  };
}

/** `null` on the server and during hydration, when the resolved theme is not known yet. */
export function useTheme(): Theme | null {
  return useSyncExternalStore<Theme | null>(subscribe, current, () => null);
}
