"use client";
import { useEffect, useRef } from "react";

/** Progressive enhancement: content remains visible without JS or with reduced motion. */
export function VeyaMotion({ children }: { children: React.ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const elements = root.current?.querySelectorAll<HTMLElement>("[data-reveal]");
    if (!elements) return;
    let observer: IntersectionObserver | undefined;
    const setup = () => {
      observer?.disconnect();
      elements.forEach(el => el.classList.remove("reveal-pending"));
      if (media.matches) return;
      observer = new IntersectionObserver(entries => entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.remove("reveal-pending");
          observer?.unobserve(entry.target);
        }
      }), { threshold: 0.12 });
      elements.forEach(el => {
        if (el.getBoundingClientRect().top > window.innerHeight) el.classList.add("reveal-pending");
        observer?.observe(el);
      });
    };
    setup();
    media.addEventListener("change", setup);
    return () => { observer?.disconnect(); media.removeEventListener("change", setup); };
  }, []);
  return <div ref={root} className="veya-landing">{children}</div>;
}
