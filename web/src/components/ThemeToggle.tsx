"use client";
/**
 * Light/dark switch. The new theme is wiped over the old one as a circle growing out of the button
 * (View Transitions API) with a small spark at its origin — ported from Lumenia's ThemeToggle (MIT, see
 * THIRD_PARTY_NOTICES.md). Reduced motion, or a browser without the API, gets an instant flip.
 *
 * flushSync is load-bearing: startViewTransition snapshots the DOM when its callback returns, so the
 * data-theme write and the re-render it triggers both have to land inside the callback.
 */
import { useCallback, useRef } from "react";
import { createPortal, flushSync } from "react-dom";
import { setTheme, useTheme } from "@/lib/theme";
import { useCopy } from "./Product";

const SWEEP_MS = 720;
const SWEEP_EASE = "cubic-bezier(.66,0,.2,1)";

type ViewTransitionDocument = Document & { startViewTransition?: (callback: () => void) => { ready: Promise<void> } };

export function ThemeToggle() {
  const theme = useTheme();
  const c = useCopy();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const sparkRef = useRef<HTMLSpanElement>(null);
  const isDark = theme === "dark";

  const flip = useCallback(() => {
    const next = isDark ? "light" : "dark";
    const button = buttonRef.current;
    const doc = document as ViewTransitionDocument;
    const sweepable = typeof doc.startViewTransition === "function" && button !== null && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!sweepable) {
      setTheme(next);
      return;
    }

    // the wipe starts at the button and has to reach the farthest corner of the viewport
    const rect = button.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));

    const spark = sparkRef.current;
    if (spark) {
      spark.style.left = `${x}px`;
      spark.style.top = `${y}px`;
      spark.classList.remove("theme-spark--lit");
      void spark.offsetWidth; // restart the flash on a rapid re-toggle
    }

    const transition = doc.startViewTransition(() => flushSync(() => setTheme(next)));
    void transition.ready.then(() => {
      spark?.classList.add("theme-spark--lit");
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: SWEEP_MS, easing: SWEEP_EASE, pseudoElement: "::view-transition-new(root)" },
      );
    });
  }, [isDark]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="product-nav-tool"
        aria-label={isDark ? c("Switch to light theme", "Açık temaya geç") : c("Switch to dark theme", "Koyu temaya geç")}
        onClick={flip}
      >
        {/* until hydration the resolved theme is unknown; the moon is the stable placeholder */}
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {isDark ? (
            <>
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
            </>
          ) : (
            <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
          )}
        </svg>
      </button>
      {/* on <body>: the nav's backdrop-filter would otherwise become the containing block of this fixed element */}
      {theme !== null && createPortal(<span ref={sparkRef} className="theme-spark" aria-hidden="true" />, document.body)}
    </>
  );
}
