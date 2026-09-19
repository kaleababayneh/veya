"use client";
import { useEffect, useState } from "react";
import { nowSec, secondsToClock } from "@/lib/format";

export function Countdown({ until, className = "" }: { until: number; className?: string }) {
  const [left, setLeft] = useState(until - nowSec());
  useEffect(() => {
    const t = setInterval(() => setLeft(until - nowSec()), 1000);
    return () => clearInterval(t);
  }, [until]);
  const danger = left < 15 * 60;
  return (
    <span className={`font-mono tabular-nums ${danger ? "text-danger" : ""} ${className}`}>
      {left > 0 ? secondsToClock(left) : "expired"}
    </span>
  );
}
