"use client";

import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { recoverMessageAddress, recoverTypedDataAddress, toHex, type Hex } from "viem";

type Eip1193 = { isMiniPay?: boolean; request(args: { method: string; params?: unknown[] }): Promise<unknown> };
declare global {
  interface Window {
    ethereum?: Eip1193;
  }
}

const FORNO = "https://forno.celo.org";
const SIGN_MESSAGE = "Arbolito MiniPay check, no funds move";
const lower = (s: unknown) => (typeof s === "string" ? s.toLowerCase() : s);

interface Results {
  at: string;
  userAgent: string;
  detect?: { hasEthereum: boolean; isMiniPay: boolean | null; accounts: unknown; chainId: unknown; error?: string };
  personalSign?: { supported: boolean; signature?: string; recoveredMatches?: boolean; error?: string };
  signTypedDataV4?: { supported: boolean; signature?: string; recoveredMatches?: boolean; error?: string };
  txNoFeeCurrency?: TxResult;
  txUsdtFeeCurrency?: TxResult;
}

interface TxResult {
  requestedFeeCurrency: string | null;
  hash?: string;
  error?: string;
  mined?: boolean;
  status?: string;
  suffixSurvived?: boolean;
  inputExactlySuffix?: boolean;
  inputLength?: number;
  minedFeeCurrency?: string | null;
  txType?: string;
}

const errText = (e: unknown) => {
  const x = e as { code?: unknown; message?: unknown };
  return `${x?.code !== undefined ? `[${String(x.code)}] ` : ""}${typeof x?.message === "string" ? x.message : String(e)}`.slice(0, 300);
};

async function rpc(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(FORNO, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (j.error) throw new Error(j.error.message);
  return j.result;
}

/** A TakerControl-shaped payload (Textile's one-time proof); the server never sees this signature. */
function takerControl(account: Hex) {
  const nonce = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const issuedAt = Date.now();
  return {
    json: {
      types: {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
        ],
        TakerControl: [
          { name: "taker", type: "address" },
          { name: "chainId", type: "uint256" },
          { name: "nonce", type: "bytes32" },
          { name: "issuedAt", type: "uint256" },
        ],
      },
      primaryType: "TakerControl",
      domain: { name: "Textile Taker Control", version: "1", chainId: 42220 },
      message: { taker: account, chainId: 42220, nonce, issuedAt },
    },
    viem: {
      domain: { name: "Textile Taker Control", version: "1", chainId: 42220 },
      types: {
        TakerControl: [
          { name: "taker", type: "address" },
          { name: "chainId", type: "uint256" },
          { name: "nonce", type: "bytes32" },
          { name: "issuedAt", type: "uint256" },
        ],
      },
      primaryType: "TakerControl" as const,
      message: { taker: account, chainId: 42220n, nonce, issuedAt: BigInt(issuedAt) },
    },
  };
}

export function MiniPayCheck({ code, suffix, usdtAdapter }: { code: string | null; suffix: Hex | null; usdtAdapter: string }) {
  const [r, setR] = useState<Results>({ at: "", userAgent: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const account = (Array.isArray(r.detect?.accounts) ? r.detect.accounts[0] : undefined) as Hex | undefined;

  // 1. Detection and auto-connect: eth_accounts never prompts.
  useEffect(() => {
    const eth = window.ethereum;
    const base = { at: new Date().toISOString(), userAgent: navigator.userAgent };
    if (!eth) {
      setR({ ...base, detect: { hasEthereum: false, isMiniPay: null, accounts: null, chainId: null } });
      return;
    }
    Promise.all([eth.request({ method: "eth_accounts" }), eth.request({ method: "eth_chainId" })])
      .then(([accounts, chainId]) => setR({ ...base, detect: { hasEthereum: true, isMiniPay: eth.isMiniPay === true, accounts, chainId } }))
      .catch((e: unknown) => setR({ ...base, detect: { hasEthereum: true, isMiniPay: eth.isMiniPay === true, accounts: null, chainId: null, error: errText(e) } }));
  }, []);

  const personalSign = useCallback(async () => {
    if (!window.ethereum || !account) return;
    setBusy("sign");
    try {
      const signature = (await window.ethereum.request({ method: "personal_sign", params: [toHex(SIGN_MESSAGE), account] })) as Hex;
      const signer = await recoverMessageAddress({ message: SIGN_MESSAGE, signature });
      setR((x) => ({ ...x, personalSign: { supported: true, signature, recoveredMatches: lower(signer) === lower(account) } }));
    } catch (e) {
      setR((x) => ({ ...x, personalSign: { supported: false, error: errText(e) } }));
    } finally {
      setBusy(null);
    }
  }, [account]);

  const signTyped = useCallback(async () => {
    if (!window.ethereum || !account) return;
    setBusy("typed");
    const td = takerControl(account);
    try {
      const signature = (await window.ethereum.request({ method: "eth_signTypedData_v4", params: [account, JSON.stringify(td.json)] })) as Hex;
      const signer = await recoverTypedDataAddress({ ...td.viem, signature });
      setR((x) => ({ ...x, signTypedDataV4: { supported: true, signature, recoveredMatches: lower(signer) === lower(account) } }));
    } catch (e) {
      setR((x) => ({ ...x, signTypedDataV4: { supported: false, error: errText(e) } }));
    } finally {
      setBusy(null);
    }
  }, [account]);

  const sendTagged = useCallback(
    async (withFee: boolean) => {
      if (!window.ethereum || !account || !suffix) return;
      const key = withFee ? "txUsdtFeeCurrency" : "txNoFeeCurrency";
      const requestedFeeCurrency = withFee ? usdtAdapter : null;
      setBusy(key);
      const tx: Record<string, string> = { from: account, to: account, value: "0x0", data: suffix };
      if (withFee) tx.feeCurrency = usdtAdapter;
      let out: TxResult = { requestedFeeCurrency };
      try {
        const hash = (await window.ethereum.request({ method: "eth_sendTransaction", params: [tx] })) as string;
        out = { ...out, hash };
        setR((x) => ({ ...x, [key]: out }));
        // Read it back from forno (not the wallet) until it is mined, ~1 s blocks.
        for (let i = 0; i < 40; i++) {
          const mined = (await rpc("eth_getTransactionByHash", [hash]).catch(() => null)) as Record<string, string> | null;
          const receipt = (await rpc("eth_getTransactionReceipt", [hash]).catch(() => null)) as Record<string, string> | null;
          if (mined && receipt) {
            const input = lower(mined.input) as string;
            out = {
              ...out,
              mined: true,
              status: receipt.status === "0x1" ? "success" : receipt.status,
              suffixSurvived: input.endsWith(suffix.toLowerCase()),
              inputExactlySuffix: input === suffix.toLowerCase(),
              inputLength: (input.length - 2) / 2,
              minedFeeCurrency: mined.feeCurrency ?? null,
              txType: mined.type,
            };
            break;
          }
          await new Promise((res) => setTimeout(res, 1500));
        }
        if (!out.mined) out = { ...out, mined: false, error: "not mined after ~60 s; check celoscan" };
      } catch (e) {
        out = { ...out, error: errText(e) };
      }
      setR((x) => ({ ...x, [key]: out }));
      setBusy(null);
    },
    [account, suffix, usdtAdapter],
  );

  const copy = async () => {
    const text = JSON.stringify({ ...r, attributionCode: code, suffix }, null, 2);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Old WebViews: fall back to a hidden textarea.
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <main style={S.main}>
      <h1 style={S.h1}>MiniPay check</h1>
      <p style={S.muted}>Diagnostics for the Arbolito team. Open this page inside MiniPay (Developer Mode), run each step and tap “Copy results”.</p>

      <Section n={1} title="Wallet detection (no connect prompt)">
        {!r.detect ? <p style={S.muted}>Checking…</p> : <Json v={r.detect} />}
      </Section>

      <Section n={2} title="personal_sign (no funds move)">
        <p style={S.muted}>Signs the text “{SIGN_MESSAGE}”.</p>
        <button style={S.btn} disabled={!account || !!busy} onClick={personalSign}>
          {busy === "sign" ? "Waiting for MiniPay…" : "Sign message"}
        </button>
        {r.personalSign && <Json v={r.personalSign} />}
      </Section>

      <Section n={3} title="eth_signTypedData_v4 (TakerControl shape, no funds move)">
        <button style={S.btn} disabled={!account || !!busy} onClick={signTyped}>
          {busy === "typed" ? "Waiting for MiniPay…" : "Sign typed data"}
        </button>
        {r.signTypedDataV4 && <Json v={r.signTypedDataV4} />}
      </Section>

      <Section n={4} title="Tagged 0-value self-transfer">
        <p style={S.warn}>
          Each button sends a real transaction that moves no money; it costs a few cents of network fee in your dollars. It sends 0 to your own wallet with only the
          Arbolito tag as data, then reads it back from the network.
        </p>
        {!suffix ? (
          <p style={S.warn}>ATTRIBUTION_CODE is not configured on the server, so this step is disabled.</p>
        ) : (
          <>
            <p style={S.muted}>
              Code <code style={S.code}>{code}</code>, suffix <code style={S.code}>{suffix}</code>
            </p>
            <div style={S.row}>
              <button style={S.btn} disabled={!account || !!busy} onClick={() => sendTagged(false)}>
                {busy === "txNoFeeCurrency" ? "Sending…" : "Send (no feeCurrency)"}
              </button>
              <button style={S.btn} disabled={!account || !!busy} onClick={() => sendTagged(true)}>
                {busy === "txUsdtFeeCurrency" ? "Sending…" : "Send (feeCurrency = USDT adapter)"}
              </button>
            </div>
            {r.txNoFeeCurrency && <Json v={r.txNoFeeCurrency} />}
            {r.txUsdtFeeCurrency && <Json v={r.txUsdtFeeCurrency} />}
          </>
        )}
      </Section>

      <button style={{ ...S.btn, ...S.primary }} onClick={copy}>
        {copied ? "Copied" : "Copy results"}
      </button>
    </main>
  );
}

function Section({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section style={S.card}>
      <h2 style={S.h2}>
        {n}. {title}
      </h2>
      {children}
    </section>
  );
}

function Json({ v }: { v: unknown }) {
  return <pre style={S.pre}>{JSON.stringify(v, null, 2)}</pre>;
}

const S: Record<string, CSSProperties> = {
  main: { maxWidth: 640, margin: "0 auto", padding: "var(--s-4) 16px var(--s-12)", color: "var(--text)", background: "var(--bg)", minHeight: "100vh", fontFamily: "var(--font-sans)" },
  h1: { fontFamily: "var(--font-serif)", fontSize: 32, margin: "var(--s-2) 0" },
  h2: { fontSize: 16, margin: "0 0 var(--s-2)" },
  muted: { color: "var(--muted)", fontSize: 14, margin: "0 0 var(--s-2)" },
  warn: { background: "var(--attention-bg)", color: "var(--attention-text)", borderRadius: "var(--r-tag)", padding: "var(--s-2) var(--s-3)", fontSize: 14, margin: "0 0 var(--s-2)" },
  card: { background: "var(--surface)", border: "1px solid var(--card-border)", borderRadius: "var(--r-card)", padding: "var(--s-4)", margin: "var(--s-3) 0" },
  row: { display: "flex", flexWrap: "wrap", gap: "var(--s-2)" },
  btn: { minHeight: 44, padding: "0 var(--s-4)", borderRadius: "var(--r-pill)", border: "1px solid var(--card-border)", background: "var(--surface-2)", color: "var(--text)", fontWeight: 600, fontSize: 15 },
  primary: { background: "var(--primary-bg)", color: "var(--primary-text)", border: "none", width: "100%", marginTop: "var(--s-2)" },
  pre: { fontFamily: "var(--font-mono)", fontSize: 12, background: "var(--surface-2)", borderRadius: "var(--r-tag)", padding: "var(--s-2)", overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all", margin: "var(--s-2) 0 0" },
  code: { fontFamily: "var(--font-mono)", fontSize: 12, wordBreak: "break-all" },
};
