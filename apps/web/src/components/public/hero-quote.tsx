"use client";
/**
 * The hero's floating quote card ("RECIBÍS · VENCE EN 48 S"): what R$ 10 gets at the live market
 * rate right now, with the design's 48-second countdown. The numbers come from the server; the
 * countdown restarts when it runs out, as a quote in the app would be refreshed.
 */
import { useEffect, useState } from "react";

const WINDOW_S = 48;

export function HeroQuote({ label, expires, amount, sub, pct }: { label: string; expires: string; amount: string; sub: string; pct: string | null }) {
  const [left, setLeft] = useState(WINDOW_S);
  useEffect(() => {
    const iv = setInterval(() => setLeft((s) => (s <= 1 ? WINDOW_S : s - 1)), 1000);
    return () => clearInterval(iv);
  }, []);
  return (
    <div className="card glass float-card bob">
      <span className="float-label mono float-label-row">
        <span>{label}</span>
        <span className={left <= 10 ? "nowrap accent-pink" : "nowrap"}>{expires.replace("{n}", String(left))}</span>
      </span>
      <span className="amount-xl">{amount}</span>
      <span className="muted">
        {sub}
        {pct && (
          <>
            {" · "}
            <b className="tag-lime">{pct}</b>
          </>
        )}
      </span>
    </div>
  );
}
