"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Address } from "viem";
import type { Sym } from "../../lib/miniapp/contract";
import type { ApiClient, AutoStatus, Balances, Quote, Rates } from "../../lib/miniapp/client/api";
import type { ExecResult, ExecStage } from "../../lib/miniapp/client/execute";
import type { Cur, Lang } from "../../lib/miniapp/client/format";
import type { Prices } from "../../lib/miniapp/client/derive";
import type { Contact, ReceiptIndexEntry, Store } from "../../lib/miniapp/client/store";
import type { Wallet } from "../../lib/miniapp/client/wallet";
import type { MiniDict } from "../../i18n/miniapp";
import type { ClientErrorCode } from "../../lib/miniapp/client/errors";
import type { Screen } from "./screens";
import { ActionBar, type BtnSpec } from "./ui";

export interface BalState {
  status: "loading" | "ok" | "offline";
  data: Balances | null;
  /** When `data` was fetched (ms); for "saldos de hace N minutos". */
  at: number | null;
}

export interface ChangeState {
  from: Sym;
  to: Sym;
  amount: string;
  quote: Quote | null;
  /** When the quote arrived (ms): the countdown bar spans receivedAt → expiresAt. */
  quoteAt: number;
  /** The quote shown before a price change (for "El precio cambió"). */
  prev: Quote | null;
  busy: boolean;
}

export interface ExecState {
  flow: "change" | "send";
  stage: ExecStage | null;
  result: ExecResult | null;
  /** Number of wallet confirmations this execution needs (for "1/2"). */
  total: number;
  from: Sym | null;
  to: Sym | null;
  amountIn: string | null;
  expectedOut: string | null;
  contactName: string | null;
  receiptId: string | null;
}

export interface SendState {
  contactId: string | null;
  pay: Cur;
  amount: string;
  quote: Quote | null;
  quoteAt: number;
  busy: boolean;
}

export type Preset = "low" | "mid" | "high";
export const PRESETS: Record<Preset, [number, number]> = { low: [10, 50], mid: [25, 100], high: [100, 500] };

export interface AutoDraft {
  preset: Preset;
  contactIds: string[];
  busy: boolean;
}

export type ChatMsg =
  | { id: string; kind: "bot"; text: string }
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "voice"; text: string | null; secs: number }
  | { id: string; kind: "typing" }
  | { id: string; kind: "quote"; quote: Quote; at: number; status: "live" | "used" | "cancelled" | "busy" }
  | { id: string; kind: "proc"; text: string }
  | { id: string; kind: "done"; title: string; text: string; receiptId: string | null }
  | { id: string; kind: "cancel"; quoteMsgId: string };

export interface AppCtx {
  t: MiniDict;
  lang: Lang;
  setLang(l: Lang): void;
  mock: boolean;
  account: Address;
  api: ApiClient;
  wallet: Wallet;
  store: Store;
  persona: { name: string; phone: string } | null;
  displayCur: Cur;

  screen: Screen;
  go(s: Screen, o?: { replace?: boolean }): void;
  back(): void;
  toast(msg: string): void;
  showError(code: ClientErrorCode): void;
  setSheet(s: "lang" | "details" | null): void;
  /** Opens a link in the same view (MiniPay rule: no new tabs). */
  openLink(url: string): void;

  bal: BalState;
  rates: Rates | null;
  prices: Prices;
  refreshBalances(): void;
  auto: AutoStatus | null;
  refreshAuto(): void;
  receipts: ReceiptIndexEntry[];
  contacts: Contact[];
  saveContact(c: Contact): void;
  finishOnboarding(next: Screen): void;
  startRipio(sym: "wARS" | "wBRL"): void;

  ch: ChangeState;
  setCh(p: Partial<ChangeState>): void;
  requestQuote(): void;
  confirmQuote(): void;
  exec: ExecState;

  send: SendState;
  setSend(p: Partial<SendState>): void;
  requestSendQuote(): void;
  confirmSend(): void;

  autoDraft: AutoDraft;
  setAutoDraft(p: Partial<AutoDraft>): void;
  activateAuto(): void;
  revokeAuto(): void;
  setPaused(paused: boolean): void;

  receiptId: string | null;
  openReceipt(id: string): void;

  chat: { msgs: ChatMsg[]; recording: boolean; busy: boolean };
  chatText(text: string): void;
  chatVoice(blob: Blob, secs: number): void;
  setRecording(r: boolean): void;
  chatConfirm(msgId: string): void;
  chatCancel(msgId: string): void;
  chatRefresh(msgId: string): void;
  chatAlts(msgId: string): void;
}

export const AppContext = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const a = useContext(AppContext);
  if (!a) throw new Error("useApp outside the Mini App");
  return a;
}

/** Ticks every `ms` (for countdowns). */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** A screen body: scrollable content plus the bottom action bar. */
export function Frame({ children, note, primary, secondary }: { children: ReactNode; note?: string; primary?: BtnSpec | null; secondary?: { label: string; onClick: () => void } | null }) {
  return (
    <>
      <div className="mp-scroll">{children}</div>
      <ActionBar note={note} primary={primary} secondary={secondary} />
    </>
  );
}
