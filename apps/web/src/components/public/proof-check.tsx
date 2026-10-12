"use client";

import { useRef, useState } from "react";

export interface ProofCheckLabels {
  idleTitle: string;
  idleSub: string;
  runTitle: string;
  okTitle: string;
  okSub: string;
  badTitle: string;
  badSub: string;
  unknownTitle: string;
  unknownSub: string;
  local: string;
  registered: string;
  notRegistered: string;
  tap: string;
  cta: string;
  ctaRun: string;
  ctaAgain: string;
  error: string;
  open: string;
}

type State = "idle" | "run" | "ok" | "bad" | "unknown" | "error";

const HEX = "0123456789abcdef";
const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-10)}`;

/**
 * "Verificalo vos": downloads the published bundle, recomputes its keccak256 over the canonical
 * JSON in the browser and compares it with the hash the server found anchored in ArbolitoReceipts.
 * The hashing code loads only on tap. The full onchain lookup from the browser lives on /r/:id.
 */
export function ProofCheck({
  bundleUrl,
  registeredHash,
  block,
  labels,
  receiptHref,
}: {
  bundleUrl: string;
  /** The bundle hash found anchored onchain, or null when the record could not be read. */
  registeredHash: string | null;
  block: string | null;
  labels: ProofCheckLabels;
  receiptHref: string;
}) {
  const [state, setState] = useState<State>("idle");
  const [shown, setShown] = useState("");
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const run = async () => {
    if (state === "run") return;
    setState("run");
    clearInterval(timer.current);
    try {
      const [{ hashJsonText }, res] = await Promise.all([import("../../lib/canonical"), fetch(bundleUrl, { cache: "no-store" })]);
      if (!res.ok) throw new Error(String(res.status));
      const { hash } = hashJsonText(await res.text());
      if (!hash) throw new Error("invalid bundle");
      const done = () => {
        setShown(hash);
        setState(!registeredHash ? "unknown" : hash.toLowerCase() === registeredHash.toLowerCase() ? "ok" : "bad");
      };
      // A short "decoding" reveal, skipped for people who asked for less motion.
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return done();
      const target = short(hash);
      let n = 0;
      timer.current = setInterval(() => {
        n += 1;
        if (n > 24) {
          clearInterval(timer.current);
          return done();
        }
        setShown(
          target
            .split("")
            .map((ch, i) => (ch === "…" || i < n ? ch : HEX[Math.floor(Math.random() * 16)]))
            .join(""),
        );
      }, 40);
    } catch {
      setState("error");
    }
  };

  const title = { idle: labels.idleTitle, run: labels.runTitle, ok: labels.okTitle, bad: labels.badTitle, unknown: labels.unknownTitle, error: labels.idleTitle }[state];
  const sub = { idle: labels.idleSub, run: labels.idleSub, ok: labels.okSub, bad: labels.badSub, unknown: labels.unknownSub, error: labels.error }[state];
  const icon = { idle: "?", run: "…", ok: "✓", bad: "!", unknown: "✓", error: "!" }[state];
  const local = state === "idle" || state === "error" ? labels.tap : state === "run" ? shown : short(shown);

  return (
    <div className={`proof card glass proof-${state}`}>
      <div className="proof-head">
        <span className="proof-icon" aria-hidden="true">
          {icon}
        </span>
        <span className="proof-text" aria-live="polite">
          <span className="proof-title">{title}</span>
          <span className="proof-sub">{sub}</span>
        </span>
      </div>
      <div className="proof-hashes mono">
        <div className="code-box">
          <span className="muted">{labels.local}</span>
          <span>{local}</span>
        </div>
        <div className="code-box">
          <span className="muted">{registeredHash && block ? labels.registered.replace("{b}", block) : labels.notRegistered}</span>
          <span>{registeredHash ? short(registeredHash) : "—"}</span>
        </div>
      </div>
      <div className="proof-actions">
        <button type="button" className="btn btn-primary" onClick={run} disabled={state === "run"}>
          {state === "run" ? labels.ctaRun : state === "idle" || state === "error" ? labels.cta : labels.ctaAgain}
        </button>
        <a href={receiptHref} className="text-link">
          {labels.open}
        </a>
      </div>
    </div>
  );
}
