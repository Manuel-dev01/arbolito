"use client";

import { useEffect, useMemo, useState } from "react";
import { createPublicClient, http, type Address } from "viem";
import { celo } from "viem/chains";
import { messages, type Lang } from "../../i18n/messages";
import { canonicalJson, hashJsonText, routeIdToBytes32 } from "../../lib/canonical";
import { receiptsReadAbi, txUrl } from "../../lib/receipts-abi";
import type { Verification } from "../../lib/chain";

type ChainCheck =
  | { state: "idle" | "checking" | "not_found" | "rpc_error" }
  | { state: "found"; block: string; txHash?: string; routeMatch: boolean; emitterOk: boolean };

export interface VerifyPanelProps {
  lang: Lang;
  /** The published bundle JSON (any formatting); the panel canonicalizes it itself. */
  bundleJson: string;
  receiptsAddress: string | null;
  rpcUrl: string;
  downloadHref: string;
  server: { result?: Verification; error?: string };
}

/**
 * Recomputes the bundle hash in the browser from the JSON shown, then looks it up in
 * ArbolitoReceipts over a public RPC: anchoredAt(hash) → ReceiptAnchored log → routeId and emitter.
 */
export function VerifyPanel({ lang, bundleJson, receiptsAddress, rpcUrl, downloadHref, server }: VerifyPanelProps) {
  const t = messages(lang).verify;
  const initial = useMemo(() => {
    try {
      return canonicalJson(JSON.parse(bundleJson));
    } catch {
      return bundleJson;
    }
  }, [bundleJson]);
  const [text, setText] = useState(initial);
  const [copied, setCopied] = useState(false);
  const [check, setCheck] = useState<ChainCheck>({ state: "idle" });
  const [downloadUrl, setDownloadUrl] = useState(downloadHref);
  useEffect(() => setDownloadUrl(new URL(downloadHref, window.location.href).href), [downloadHref]);
  const computed = useMemo(() => hashJsonText(text), [text]);
  const routeId = useMemo(() => {
    try {
      const v: unknown = JSON.parse(text);
      return v && typeof v === "object" && "routeId" in v && typeof v.routeId === "string" ? v.routeId : undefined;
    } catch {
      return undefined;
    }
  }, [text]);
  const client = useMemo(() => createPublicClient({ chain: celo, transport: http(rpcUrl, { retryCount: 1, timeout: 10_000 }) }), [rpcUrl]);

  useEffect(() => {
    const hash = computed.hash;
    if (!hash || !receiptsAddress) return;
    let cancelled = false;
    const address = receiptsAddress as Address;
    setCheck({ state: "checking" });
    const timer = setTimeout(async () => {
      try {
        const at = await client.readContract({ address, abi: receiptsReadAbi, functionName: "anchoredAt", args: [hash] });
        if (cancelled) return;
        if (at === 0n) return setCheck({ state: "not_found" });
        const logs = await client.getLogs({
          address,
          event: receiptsReadAbi[2],
          args: { bundleHash: hash },
          fromBlock: at,
          toBlock: at,
        });
        const log = logs[0];
        const emitter = log?.args.emitter;
        const emitterOk = emitter ? await client.readContract({ address, abi: receiptsReadAbi, functionName: "isEmitter", args: [emitter] }) : false;
        if (cancelled) return;
        const expected = routeId ? routeIdToBytes32(routeId) : undefined;
        setCheck({
          state: "found",
          block: at.toString(),
          txHash: log?.transactionHash ?? undefined,
          routeMatch: !!expected && log?.args.routeId?.toLowerCase() === expected.toLowerCase(),
          emitterOk,
        });
      } catch {
        if (!cancelled) setCheck({ state: "rpc_error" });
      }
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [computed.hash, receiptsAddress, client, routeId]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const sv = server.result;
  return (
    <section className="verify" id="verify" aria-labelledby="verify-title">
      <div>
        <h3 id="verify-title">{t.title}</h3>
        <p className="lead">{t.lead}</p>
      </div>

      <div>
        <label htmlFor="canonical" className="small muted">
          {t.canonical}
        </label>
        <textarea id="canonical" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} />
        <p className="small faint">{t.editHint}</p>
        <div className="row">
          <button type="button" className="btn btn-secondary btn-sm" onClick={copy}>
            {copied ? t.copied : t.copy}
          </button>
          <a className="btn btn-secondary btn-sm" href={downloadHref} download>
            {t.download}
          </a>
          {text !== initial && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setText(initial)}>
              {t.reset}
            </button>
          )}
        </div>
      </div>

      <div>
        <div className="small muted">{t.hash} (keccak256)</div>
        <div className="hash" aria-live="polite">
          {computed.hash ?? `${t.invalidJson}: ${computed.error ?? ""}`}
        </div>
        <ul className="checks" aria-live="polite">
          {check.state === "checking" && <li className="wait">{t.checking}</li>}
          {check.state === "not_found" && <li className="no">{t.notFound}</li>}
          {check.state === "rpc_error" && <li className="no">{t.rpcError}</li>}
          {check.state === "found" && (
            <>
              <li className="ok">
                {t.found(check.block)}{" "}
                {check.txHash && (
                  <a href={txUrl(check.txHash)} target="_blank" rel="noopener noreferrer">
                    Celoscan ↗
                  </a>
                )}
              </li>
              <li className={check.routeMatch ? "ok" : "no"}>{check.routeMatch ? t.routeMatch : t.routeMismatch}</li>
              <li className={check.emitterOk ? "ok" : "no"}>{check.emitterOk ? t.emitterOk : t.emitterBad}</li>
            </>
          )}
        </ul>
      </div>

      <div>
        <h4>{t.serverTitle}</h4>
        {sv && sv.ok && <p className="pos">✓ {t.serverOk}</p>}
        {sv && !sv.ok && (
          <>
            <p className="neg">{t.serverFail}</p>
            <ul className="checks">
              {sv.errors.map((e) => (
                <li key={e} className="no mono">
                  {e}
                </li>
              ))}
            </ul>
          </>
        )}
        {!sv && (
          <p className="muted">
            {t.serverUnavailable} <span className="mono">{server.error}</span>
          </p>
        )}
      </div>

      <details className="how">
        <summary>{t.howTitle}</summary>
        <ol className="steps">
          {t.howSteps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <pre>{`// Node 22+ (ESM), viem
import { keccak256, stringToBytes } from "viem";
const canon = (v) => v === null || typeof v !== "object" ? JSON.stringify(v)
  : Array.isArray(v) ? "[" + v.map(canon).join(",") + "]"
  : "{" + Object.keys(v).filter((k) => v[k] !== undefined).sort()
      .map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
const bundle = await (await fetch("${downloadUrl}")).json();
console.log(keccak256(stringToBytes(canon(bundle))));`}</pre>
      </details>
    </section>
  );
}
