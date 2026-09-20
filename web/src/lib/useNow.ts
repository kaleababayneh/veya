"use client";
import { useEffect, useState } from "react";
export function useNow() {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const tick = () => setNow(Math.floor(Date.now() / 1000));
    const id = setInterval(tick, 1000);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", tick);
    };
  }, []);
  return now;
}
