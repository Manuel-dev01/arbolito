/**
 * MiniPay wallet layer. The user's own MiniPay wallet signs and sends every transaction; MiniPay's
 * native confirmation sheet is the only approval. Nothing here sends unless a real MiniPay provider
 * is injected (or a test/mock passes its own fake), and nothing retries a send on its own.
 */
import { createPublicClient, createWalletClient, custom, http, toHex, type Address, type Hex } from "viem";
import { celo } from "viem/chains";
import type { Call } from "../contract";
import type { NeedsProof } from "./api";
import type { Sym } from "../contract";

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown }): Promise<unknown>;
  isMiniPay?: boolean;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

export const CELO_CHAIN_ID = 42220;
/** Public RPC for receipts (never a keyed server URL). */
export const PUBLIC_RPC = "https://forno.celo.org";

/**
 * Fee-abstraction adapters for the 6-decimal dollars (pass the adapter, not the token, as
 * `feeCurrency`). Mirrors packages/config/src/tokens.ts and docs/04-reference.md, also listed in
 * MiniPay's send-transaction docs; a unit test asserts they match the config package.
 */
export const FEE_ADAPTERS: Partial<Record<Sym, Address>> = {
  USDT: "0x0E2A3e05bc9A16F5292A6170456A710cb89C6f72",
  USDC: "0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B",
  USAT: "0x0357EE22278c922e1D36cFe6b899269b161880C4",
};

/** Picks the fee adapter of the dollar the user holds most of (USDT if none). MiniPay may override it. */
export function pickFeeCurrency(balances: { sym: Sym; amount: string }[] | undefined): Address {
  let best: { sym: Sym; amount: bigint } | null = null;
  for (const b of balances ?? []) {
    if (!FEE_ADAPTERS[b.sym]) continue;
    const a = BigInt(b.amount);
    if (a > 0n && (!best || a > best.amount)) best = { sym: b.sym, amount: a };
  }
  return FEE_ADAPTERS[best?.sym ?? "USDT"]!;
}

export type Environment = { kind: "minipay"; provider: Eip1193Provider } | { kind: "none" };

/** MiniPay injects window.ethereum with isMiniPay. Any other wallet counts as "open from MiniPay". */
export function detectMiniPay(w: { ethereum?: Eip1193Provider } | undefined = typeof window === "undefined" ? undefined : window): Environment {
  const eth = w?.ethereum;
  return eth && eth.isMiniPay === true ? { kind: "minipay", provider: eth } : { kind: "none" };
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Auto-connect: MiniPay exposes the account without a prompt, so there is no connect button and no
 * "connecting" state. eth_accounts first; eth_requestAccounts only if MiniPay hasn't exposed it yet.
 */
export async function getAccount(provider: Eip1193Provider): Promise<Address> {
  const first = (r: unknown) => (Array.isArray(r) && typeof r[0] === "string" && ADDRESS_RE.test(r[0]) ? (r[0] as Address) : null);
  const a = first(await provider.request({ method: "eth_accounts" }));
  if (a) return a;
  const b = first(await provider.request({ method: "eth_requestAccounts" }));
  if (b) return b;
  throw new Error("MiniPay exposed no account");
}

/** True for EIP-1193 4001 / viem's UserRejectedRequestError anywhere in the cause chain. */
export function isUserRejection(e: unknown): boolean {
  let cur: unknown = e;
  for (let depth = 0; cur && depth < 8; depth++) {
    const o = cur as { code?: unknown; name?: unknown; cause?: unknown };
    if (o.code === 4001 || o.name === "UserRejectedRequestError") return true;
    cur = o.cause;
  }
  return false;
}

// ── The call sequencer ─────────────────────────────────────────────────────

export interface TxSender {
  /** Sends one call through the wallet (MiniPay shows its sheet) and returns the tx hash. */
  send(call: Call, index: number): Promise<Hex>;
}
export interface ReceiptWaiter {
  /** Waits for the receipt. Throws on timeout/RPC failure (the outcome is then unknown). */
  wait(hash: Hex): Promise<"success" | "reverted">;
}

export type SendOutcome =
  | { kind: "sent"; hashes: Hex[] }
  /** The user rejected in MiniPay. Calls before `atIndex` (if any) went through; nothing was swapped or paid. */
  | { kind: "cancelled"; hashes: Hex[]; atIndex: number }
  /** A tx reverted onchain: the swap or payment didn't happen. */
  | { kind: "failed"; hashes: Hex[]; atIndex: number; reason: "reverted" }
  /** We can't tell whether the tx went out (send error that isn't a rejection, or receipt timeout). Never retry blindly. */
  | { kind: "failed"; hashes: Hex[]; atIndex: number; reason: "unknown"; error: string };

export interface SequencerHooks {
  /** Called right after MiniPay returns a hash for call `index`. */
  onSent?(index: number, hash: Hex): void;
  /** Called after call `index`'s receipt succeeded. */
  onConfirmed?(index: number, hash: Hex): void;
}

/** Sends each call in order, waiting for each receipt before the next (approval first, then swap). */
export async function sendCallsInOrder(calls: readonly Call[], sender: TxSender, waiter: ReceiptWaiter, hooks: SequencerHooks = {}): Promise<SendOutcome> {
  const hashes: Hex[] = [];
  for (let i = 0; i < calls.length; i++) {
    let hash: Hex;
    try {
      hash = await sender.send(calls[i]!, i);
    } catch (e) {
      if (isUserRejection(e)) return { kind: "cancelled", hashes, atIndex: i };
      return { kind: "failed", hashes, atIndex: i, reason: "unknown", error: e instanceof Error ? e.message : String(e) };
    }
    hashes.push(hash);
    hooks.onSent?.(i, hash);
    let status: "success" | "reverted";
    try {
      status = await waiter.wait(hash);
    } catch (e) {
      return { kind: "failed", hashes, atIndex: i, reason: "unknown", error: e instanceof Error ? e.message : String(e) };
    }
    if (status !== "success") return { kind: "failed", hashes, atIndex: i, reason: "reverted" };
    hooks.onConfirmed?.(i, hash);
  }
  return { kind: "sent", hashes };
}

/** A sender backed by a viem wallet client over the injected provider, on Celo. */
export function createViemSender(provider: Eip1193Provider, account: Address, feeCurrency?: () => Address | undefined): TxSender {
  const wallet = createWalletClient({ account, chain: celo, transport: custom(provider) });
  return {
    async send(call) {
      const fc = feeCurrency?.();
      return wallet.sendTransaction({
        account,
        chain: celo,
        to: call.to as Address,
        data: call.data as Hex,
        value: BigInt(call.value),
        ...(fc ? { feeCurrency: fc } : {}),
      });
    },
  };
}

export function createFornoWaiter(timeoutMs = 90_000): ReceiptWaiter {
  const client = createPublicClient({ chain: celo, transport: http(PUBLIC_RPC, { retryCount: 2, timeout: 10_000 }) });
  return {
    async wait(hash) {
      const r = await client.waitForTransactionReceipt({ hash, timeout: timeoutMs, pollingInterval: 1_000 });
      return r.status;
    },
  };
}

// ── Signing (Textile's one-time taker proof) ───────────────────────────────

export interface ProofSigner {
  signTypedData(typedData: unknown): Promise<Hex>;
  personalSign(message: string): Promise<Hex>;
}

export interface TakerProof {
  nonce: Hex;
  issuedAt: number;
  signature: Hex;
  scheme: "eip712" | "eip191";
}

/**
 * Signs the taker proof: EIP-712 first, falling back to personal_sign of `eip191Message` when the
 * wallet doesn't support typed data. A user rejection is rethrown (→ the cancelled end state).
 */
export async function signTakerProof(signer: ProofSigner, needs: Pick<NeedsProof, "typedData" | "eip191Message" | "nonce" | "issuedAt">): Promise<TakerProof> {
  const base = { nonce: needs.nonce as Hex, issuedAt: needs.issuedAt };
  if (needs.typedData) {
    try {
      return { ...base, signature: await signer.signTypedData(needs.typedData), scheme: "eip712" };
    } catch (e) {
      if (isUserRejection(e)) throw e;
    }
  }
  return { ...base, signature: await signer.personalSign(needs.eip191Message), scheme: "eip191" };
}

export function createProviderSigner(provider: Eip1193Provider, account: Address): ProofSigner {
  return {
    async signTypedData(typedData) {
      return (await provider.request({ method: "eth_signTypedData_v4", params: [account, JSON.stringify(typedData)] })) as Hex;
    },
    async personalSign(message) {
      return (await provider.request({ method: "personal_sign", params: [toHex(message), account] })) as Hex;
    },
  };
}

// ── MiniPay custom methods ─────────────────────────────────────────────────

/** Opens MiniPay's native contact picker. Null if unsupported or dismissed. */
export async function requestContact(provider: Eip1193Provider): Promise<{ name: string; address: Address } | null> {
  try {
    const r = (await provider.request({ method: "minipay_requestContact", params: [] })) as { name?: unknown; address?: unknown } | null;
    if (r && typeof r.name === "string" && typeof r.address === "string" && ADDRESS_RE.test(r.address)) return { name: r.name, address: r.address as Address };
    return null;
  } catch {
    return null;
  }
}

/** MiniPay's own exchange rate (e.g. USDT → ARS) for display; null if unsupported. */
export async function getExchangeRate(provider: Eip1193Provider, from: string, to: string): Promise<number | null> {
  try {
    const r = await provider.request({ method: "minipay_getExchangeRate", params: [from, to] });
    return typeof r === "number" && Number.isFinite(r) ? r : null;
  } catch {
    return null;
  }
}

/** Everything the UI needs from a wallet; the real one wraps MiniPay, the mock one the fake sheet. */
export interface Wallet {
  account: Address;
  sender: TxSender;
  waiter: ReceiptWaiter;
  signer: ProofSigner;
  requestContact(): Promise<{ name: string; address: Address } | null>;
  /** True when this is a real MiniPay wallet (vs. the demo/mock wallet). */
  real: boolean;
}

export function createMiniPayWallet(provider: Eip1193Provider, account: Address, feeCurrency?: () => Address | undefined): Wallet {
  return {
    account,
    sender: createViemSender(provider, account, feeCurrency),
    waiter: createFornoWaiter(),
    signer: createProviderSigner(provider, account),
    requestContact: () => requestContact(provider),
    real: true,
  };
}
