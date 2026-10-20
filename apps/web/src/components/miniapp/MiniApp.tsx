"use client";

/**
 * The MiniPay Mini App shell and controller. Boots the environment (real MiniPay or ?mock=1),
 * owns the flow state, keeps the in-app ‹ in sync with history.pushState, and renders the screen.
 *
 * Real money rule: in real mode the only way a transaction leaves is the user's own MiniPay sheet,
 * triggered by a button that says "en MiniPay". Nothing is sent or re-sent automatically.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Address } from "viem";
import { fill, miniT, pickLang, DISPLAY_CUR, type Lang } from "../../i18n/miniapp";
import { cancelText } from "@arbolito/rules";
import { createApiClient, type ApiClient, type AutoStatus, type Balances, type Quote, type Rates, type Rule } from "../../lib/miniapp/client/api";
import { pricesFrom, limitsFromUsd } from "../../lib/miniapp/client/derive";
import { mapApiError, type ClientErrorCode } from "../../lib/miniapp/client/errors";
import { executeCalls, executeQuote, submitWithRetry, type ExecResult, type ExecStage } from "../../lib/miniapp/client/execute";
import { atomicToTyped, DECIMALS, SYM_OF, fmtNumber, fmtPct, fmtSym, parseHuman, toApiAmount, type Cur } from "../../lib/miniapp/client/format";
import {
  createMockServer,
  createMockWallet,
  memoryKV,
  MOCK_ACCOUNT,
  MOCK_CONTACTS,
  MOCK_PERSONA,
  type MockFail,
  type MockScenario,
  type SheetRequest,
} from "../../lib/miniapp/client/mock";
import { createStore, newId, type Contact, type ReceiptIndexEntry, type Store } from "../../lib/miniapp/client/store";
import { createMiniPayWallet, detectMiniPay, getAccount, isUserRejection, pickFeeCurrency, type Wallet } from "../../lib/miniapp/client/wallet";
import { AppContext, PRESETS, type AppCtx, type AutoDraft, type BalState, type ChangeState, type ChatMsg, type ExecState, type SendState } from "./context";
import { HEADER, STATE_ALIASES, STEP, TABS, TAB_SCREENS, isScreen, type Screen } from "./screens";
import { Header } from "./ui";
import { Gate } from "./screens/Gate";
import { ScreenView } from "./screens/ScreenView";
import { DetailsSheet, LangSheet, MiniPaySheet } from "./sheets";
import { codeFromUrl, LinkScreen } from "./screens/Link";

const MOCK_FAILS: MockFail[] = ["reject", "revert", "no_route", "price_changed", "proof", "expired", "not_ready", "upstream", "mismatch"];

interface Boot {
  mock: boolean;
  state: string | null;
  quoteId: string | null;
  lang: string | null;
  fail: MockFail | null;
  chat: string | null;
  /** Mock only: /quotes/open returns a waiting Telegram quote. */
  resume: boolean;
}

function readBoot(): Boot {
  const p = new URLSearchParams(window.location.search);
  const fail = p.get("fail");
  return {
    mock: p.get("mock") === "1",
    state: p.get("state"),
    quoteId: /^[0-9a-f-]{36}$/i.test(p.get("quote") ?? "") ? p.get("quote") : null,
    lang: p.get("lang"),
    fail: MOCK_FAILS.includes(fail as MockFail) ? (fail as MockFail) : null,
    chat: p.get("chat"),
    resume: p.get("resume") === "1",
  };
}

type Env =
  | { phase: "boot" }
  | { phase: "no-minipay" }
  | { phase: "conn-fail" }
  | { phase: "ready"; mock: boolean; account: Address; api: ApiClient; wallet: Wallet; store: Store; persona: { name: string; phone: string } | null; scenario: MockScenario };

/** A quote's input as an API/keypad amount ("10", "10.5"). Quotes come from 2-decimal typed amounts. */
const amountOf = (q: Quote) => atomicToTyped(BigInt(q.amountIn), DECIMALS[q.from]);

const EMPTY_EXEC: ExecState ={ flow: "change", stage: null, result: null, total: 0, from: null, to: null, amountIn: null, expectedOut: null, contactName: null, receiptId: null };

export function MiniApp({ mode = "app" }: { mode?: "app" | "link" }) {
  const [lang, setLangState] = useState<Lang>("es");
  const t = miniT(lang);
  const [env, setEnv] = useState<Env>({ phase: "boot" });
  const bootRef = useRef<Boot | null>(null);
  const [screen, setScreen] = useState<Screen>("home");
  const depth = useRef(0);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sheet, setSheet] = useState<"lang" | "details" | null>(null);
  const [mpReq, setMpReq] = useState<{ req: SheetRequest; resolve(ok: boolean): void } | null>(null);
  const sheetAmount = useRef<string>("");

  const [bal, setBal] = useState<BalState>({ status: "loading", data: null, at: null });
  const [rates, setRates] = useState<Rates | null>(null);
  const [auto, setAuto] = useState<AutoStatus | null>(null);
  const [receipts, setReceipts] = useState<ReceiptIndexEntry[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [ch, setChState] = useState<ChangeState>({ from: "wBRL", to: "wARS", amount: "10", quote: null, quoteAt: 0, prev: null, busy: false });
  const [exec, setExec] = useState<ExecState>(EMPTY_EXEC);
  const [send, setSendState] = useState<SendState>({ contactId: null, pay: "USD", amount: "20", quote: null, quoteAt: 0, busy: false });
  const [autoDraft, setAutoDraftState] = useState<AutoDraft>({ preset: "mid", contactIds: [], busy: false });
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [chat, setChat] = useState<{ msgs: ChatMsg[]; recording: boolean; busy: boolean }>({ msgs: [], recording: false, busy: false });

  const setCh = useCallback((p: Partial<ChangeState>) => setChState((s) => ({ ...s, ...p })), []);
  const setSend = useCallback((p: Partial<SendState>) => setSendState((s) => ({ ...s, ...p })), []);
  const setAutoDraft = useCallback((p: Partial<AutoDraft>) => setAutoDraftState((s) => ({ ...s, ...p })), []);

  const toast = useCallback((msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToastMsg(msg);
    toastTimer.current = setTimeout(() => setToastMsg(null), 2600);
  }, []);

  // ── Navigation, synced with history so MiniPay's back and our ‹ agree ──
  const go = useCallback((s: Screen, o?: { replace?: boolean }) => {
    setScreen(s);
    setSheet(null);
    try {
      if (o?.replace) window.history.replaceState({ mp: s }, "");
      else {
        window.history.pushState({ mp: s }, "");
        depth.current++;
      }
    } catch {
      /* history unavailable: in-app state still works */
    }
  }, []);

  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const s = (e.state as { mp?: unknown } | null)?.mp;
      depth.current = Math.max(0, depth.current - 1);
      if (isScreen(s)) {
        setScreen(s);
        setSheet(null);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const back = useCallback(() => {
    if (depth.current > 0) window.history.back();
    else go(HEADER[screen]?.[1] ?? "home", { replace: true });
  }, [go, screen]);

  const openLink = useCallback((url: string) => {
    window.location.href = url;
  }, []);

  const setFeeBalancesRef = useRef<(b: Balances) => void>(() => {});

  // ── Boot: detect MiniPay (or mock), auto-connect, pick the first screen ──
  const boot = useCallback(async () => {
    const b = bootRef.current ?? readBoot();
    bootRef.current = b;
    const store0 = createStore();
    const l = pickLang(b.lang ?? store0.lang(), typeof navigator !== "undefined" ? navigator.language : null);
    setLangState(l);

    if (b.mock) {
      const alias = b.state ? STATE_ALIASES[b.state] : undefined;
      const scenario: MockScenario = { ...(alias?.scenario ?? {}), fail: b.fail, openQuote: b.resume };
      const server = createMockServer(scenario);
      const api = createApiClient({ fetch: server.fetch });
      const store = createStore(memoryKV());
      if (!scenario.noContacts) for (const c of MOCK_CONTACTS[l]) store.saveContact(MOCK_ACCOUNT, { ...c, id: newId() });
      for (const r of [...server.receiptIndex()].reverse()) store.addReceipt(MOCK_ACCOUNT, r);
      store.setOnboarded(MOCK_ACCOUNT);
      const wallet = createMockWallet({ lang: l, fail: b.fail, confirm: (req) => new Promise<boolean>((resolve) => setMpReq({ req, resolve })) });
      setEnv({ phase: "ready", mock: true, account: MOCK_ACCOUNT, api, wallet, store, persona: MOCK_PERSONA[l], scenario });
      return;
    }

    const det = detectMiniPay();
    if (det.kind === "none") {
      setEnv({ phase: "no-minipay" });
      return;
    }
    try {
      const account = await getAccount(det.provider);
      const store = createStore();
      const api = createApiClient();
      let feeBalances: Balances | null = null;
      const wallet = createMiniPayWallet(det.provider, account, () => pickFeeCurrency(feeBalances?.balances));
      setEnv({ phase: "ready", mock: false, account, api, wallet, store, persona: null, scenario: {} });
      // Keep the fee currency pick fresh from the cached balances.
      feeBalances = store.cachedBalances<Balances>(account)?.data ?? null;
      setFeeBalancesRef.current = (b) => (feeBalances = b);
    } catch {
      setEnv({ phase: "conn-fail" });
    }
  }, []);
  useEffect(() => {
    void boot();
  }, [boot]);

  const ready = env.phase === "ready" ? env : null;

  const setLang = useCallback(
    (l: Lang) => {
      setLangState(l);
      ready?.store.setLang(l);
      setSheet(null);
    },
    [ready],
  );

  // ── Data ──
  const refreshBalances = useCallback(async () => {
    if (!ready) return;
    try {
      const b = await ready.api.balances(ready.account);
      setBal({ status: "ok", data: b, at: Date.now() });
      ready.store.cacheBalances(ready.account, b);
      setFeeBalancesRef.current(b);
    } catch {
      const c = ready.store.cachedBalances<Balances>(ready.account);
      setBal((prev) => ({ status: "offline", data: prev.data ?? c?.data ?? null, at: prev.at ?? c?.at ?? null }));
    }
  }, [ready]);

  const refreshAuto = useCallback(async () => {
    if (!ready) return;
    try {
      setAuto(await ready.api.autonomyStatus(ready.account));
    } catch {
      /* status unknown: the promo stays, nothing claims it's on */
    }
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    const { store, account, api } = ready;
    setReceipts(store.receipts(account));
    setContacts(store.contacts(account));
    const cached = store.cachedBalances<Balances>(account);
    if (cached) setBal({ status: "loading", data: cached.data, at: cached.at });
    void refreshBalances();
    void refreshAuto();
    api.rates().then(setRates, () => {});
    // Receipts made from another phone (or before a cleared app) come back from the server.
    api.listReceipts(account).then(
      (list) => {
        const names = new Map(store.contacts(account).filter((c) => c.address).map((c) => [c.address!.toLowerCase(), c.name]));
        store.mergeReceipts(
          account,
          list.map((r) => ({ receiptId: r.receiptId, kind: r.kind, to: r.recipient ? (names.get(r.recipient.toLowerCase()) ?? undefined) : undefined, at: r.at })),
        );
        setReceipts(store.receipts(account));
      },
      () => {},
    );
    // Re-register receipts whose /submit didn't go through last time (submit moves no money).
    const pending = store.pendingSubmits(account);
    if (pending.length) {
      void (async () => {
        const left = [];
        for (const p of pending) {
          try {
            const r = await api.submit({ quoteId: p.quoteId, account, txHashes: p.txHashes });
            store.addReceipt(account, { receiptId: r.receiptId, kind: "change", at: p.at });
          } catch {
            left.push(p);
          }
        }
        store.setPendingSubmits(account, left);
        setReceipts(store.receipts(account));
      })();
    }
    const onOnline = () => void refreshBalances();
    window.addEventListener("online", onOnline);
    const iv = setInterval(() => void refreshBalances(), 30_000);
    return () => {
      window.removeEventListener("online", onOnline);
      clearInterval(iv);
    };
  }, [ready, refreshBalances, refreshAuto]);

  const prices = useMemo(() => pricesFrom(bal.data, rates), [bal.data, rates]);

  const showError = useCallback(
    (code: ClientErrorCode) => {
      const m = mapApiError(code);
      const key = m.kind === "toast" ? m.message : "generic";
      toast({ notReady: t.errNotReady, rateLimited: t.errRate, upstream: t.errUpstream, offline: t.errOffline, generic: t.errGeneric }[key]);
    },
    [t, toast],
  );

  const addReceipt = useCallback(
    (e: ReceiptIndexEntry) => {
      if (!ready) return;
      ready.store.addReceipt(ready.account, e);
      setReceipts(ready.store.receipts(ready.account));
    },
    [ready],
  );

  const onStage = useCallback((s: ExecStage) => {
    setExec((e) => ({ ...e, stage: s, total: s.stage === "confirming" || s.stage === "sent" ? s.total : e.total }));
  }, []);

  /** After a quote's execution: route to the right end state. Never re-sends. */
  const settle = useCallback(
    async (res: ExecResult, q: Quote | null, kind: "change" | "send", contactName: string | null) => {
      if (!ready) return;
      setExec((e) => ({ ...e, result: res }));
      if (res.kind === "done") {
        const rid = res.receipt?.receiptId ?? null;
        if (rid) addReceipt({ receiptId: rid, kind, to: contactName ?? undefined, at: new Date().toISOString() });
        else if (q && res.hashes.length) {
          const list = ready.store.pendingSubmits(ready.account);
          ready.store.setPendingSubmits(ready.account, [...list, { quoteId: q.quoteId, txHashes: res.hashes, at: new Date().toISOString() }]);
        }
        setExec((e) => ({ ...e, receiptId: rid, expectedOut: res.prepared?.expectedOut ?? e.expectedOut }));
        go(kind === "send" ? "send-done" : "done", { replace: true });
        void refreshBalances();
        return;
      }
      if (res.kind === "cancelled") return go("cancelled", { replace: true });
      if (res.kind === "failed") return go("failed", { replace: true });
      const m = mapApiError(res.code);
      if (m.kind === "expired") return go(kind === "send" ? "send-quote" : "quote-expired", { replace: true });
      if (m.kind === "no-market") return go("quote-nomarket", { replace: true });
      if (m.kind === "price-changed" && q && kind === "change") {
        try {
          const amount = amountOf(q);
          const q2 = await ready.api.quote({ from: q.from, to: q.to, amount, account: ready.account, lang });
          setCh({ prev: q, quote: q2, quoteAt: Date.now() });
          return go("quote-changed", { replace: true });
        } catch (e) {
          showError((e as { code?: ClientErrorCode }).code ?? "network");
          return go("change", { replace: true });
        }
      }
      showError(res.code);
      if (screen === "processing") go(kind === "send" ? "send-quote" : "quote", { replace: true });
    },
    [ready, addReceipt, go, refreshBalances, lang, setCh, showError, screen],
  );

  // ── Change flow ──
  const requestQuote = useCallback(async () => {
    if (!ready) return;
    const amount = toApiAmount(ch.amount);
    if (!amount) return;
    setCh({ busy: true, prev: null });
    go("quote-loading", { replace: screen !== "change" });
    try {
      const q = await ready.api.quote({ from: ch.from, to: ch.to, amount, account: ready.account, lang });
      setCh({ quote: q, quoteAt: Date.now(), busy: false });
      go("quote", { replace: true });
    } catch (e) {
      setCh({ busy: false });
      const code = (e as { code?: ClientErrorCode }).code ?? "network";
      const m = mapApiError(code);
      if (m.kind === "no-market") go("quote-nomarket", { replace: true });
      else {
        showError(code);
        go("change", { replace: true });
      }
    }
  }, [ready, ch.amount, ch.from, ch.to, lang, go, screen, setCh, showError]);

  const runQuote = useCallback(
    async (q: Quote | null, quoteId: string) => {
      if (!ready) return;
      setCh({ busy: true });
      setExec({ ...EMPTY_EXEC, flow: "change", from: q?.from ?? null, to: q?.to ?? null, amountIn: q?.amountIn ?? null, expectedOut: q?.expectedOut ?? null });
      sheetAmount.current = q ? `${fmtNumber(BigInt(q.amountIn), DECIMALS[q.from], lang)} ${q.from} → ${q.to}` : "";
      let moved = false;
      const res = await executeQuote(
        {
          api: ready.api,
          wallet: ready.wallet,
          onStage: (s) => {
            onStage(s);
            if (s.stage === "sent" && !moved) {
              moved = true;
              go("processing");
            }
          },
        },
        quoteId,
      );
      setCh({ busy: false });
      await settle(res, q, "change", null);
    },
    [ready, lang, onStage, go, settle, setCh],
  );

  const confirmQuote = useCallback(() => {
    const q = ch.quote;
    if (!q || ch.busy) return;
    if (Date.parse(q.expiresAt) <= Date.now()) return go("quote-expired", { replace: true });
    void runQuote(q, q.quoteId);
  }, [ch.quote, ch.busy, go, runQuote]);

  // ── Send flow ──
  const sendContact = contacts.find((c) => c.id === send.contactId) ?? null;

  const requestSendQuote = useCallback(async () => {
    if (!ready || !sendContact) return;
    const amount = toApiAmount(send.amount);
    if (!amount) return;
    if (send.pay === sendContact.cur) {
      setSend({ quote: null, quoteAt: Date.now() });
      if (screen !== "send-quote") go("send-quote");
      return;
    }
    setSend({ busy: true });
    try {
      const q = await ready.api.quote({ from: SYM_OF[send.pay], to: SYM_OF[sendContact.cur], amount, account: ready.account, lang });
      setSend({ quote: q, quoteAt: Date.now(), busy: false });
      if (screen !== "send-quote") go("send-quote");
    } catch (e) {
      setSend({ busy: false });
      const code = (e as { code?: ClientErrorCode }).code ?? "network";
      if (mapApiError(code).kind === "no-market") {
        setCh({ from: SYM_OF[send.pay], to: SYM_OF[sendContact.cur] });
        go("quote-nomarket");
      } else showError(code);
    }
  }, [ready, sendContact, send.amount, send.pay, screen, lang, go, setSend, setCh, showError]);

  const confirmSend = useCallback(async () => {
    if (!ready || !sendContact || send.busy) return;
    if (!sendContact.address) return toast(t.needAddr);
    const amount = toApiAmount(send.amount);
    if (!amount) return;
    const q = send.quote;
    if (q && Date.parse(q.expiresAt) <= Date.now()) return void requestSendQuote();
    const from = SYM_OF[send.pay];
    const to = SYM_OF[sendContact.cur];
    setSend({ busy: true });
    const amountIn = q?.amountIn ?? parseHuman(amount, DECIMALS[from]).toString();
    setExec({ ...EMPTY_EXEC, flow: "send", from, to, amountIn, expectedOut: q?.expectedOut ?? amountIn, contactName: sendContact.name.split(" ")[0] ?? sendContact.name });
    sheetAmount.current = `${fmtNumber(BigInt(amountIn), DECIMALS[from], lang)} ${from}`;
    let moved = false;
    const deps = {
      api: ready.api,
      wallet: ready.wallet,
      onStage: (s: ExecStage) => {
        onStage(s);
        if (s.stage === "sent" && !moved) {
          moved = true;
          go("processing");
        }
      },
    };
    const res = await executeCalls(deps, () => ready.api.sendPrepare({ account: ready.account, recipient: sendContact.address!, from, to, amount, quoteId: q?.quoteId }));
    setSend({ busy: false });
    if (res.kind === "done") {
      const receipt = q ? await submitWithRetry(deps, q.quoteId, res.hashes) : null;
      await settle({ ...res, receipt }, q, "send", sendContact.name.split(" ")[0] ?? sendContact.name);
      return;
    }
    await settle(res, q, "send", null);
  }, [ready, sendContact, send.busy, send.amount, send.quote, send.pay, t, toast, requestSendQuote, setSend, lang, onStage, go, settle]);

  // ── Autonomy ──
  const activateAuto = useCallback(async () => {
    if (!ready || autoDraft.busy) return;
    const [op, day] = PRESETS[autoDraft.preset];
    const limits = limitsFromUsd(op, day, prices);
    const addrs = contacts.filter((c) => autoDraft.contactIds.includes(c.id) && c.address).map((c) => c.address!) as Address[];
    setAutoDraft({ busy: true });
    sheetAmount.current = `US$ ${op} / US$ ${day}`;
    const res = await executeCalls({ api: ready.api, wallet: ready.wallet, onStage }, () =>
      ready.api.autonomyPlan({ account: ready.account, limits, contacts: addrs, maxSlippageBps: 50, operatorDays: 30 }),
    );
    setAutoDraft({ busy: false });
    if (res.kind === "done") {
      void refreshAuto();
      return go("auto-on", { replace: true });
    }
    if (res.kind === "cancelled") return toast(t.toastCancelled);
    if (res.kind === "failed") return toast(res.reason === "unknown" ? t.unknownB : t.errGeneric);
    showError(res.code);
  }, [ready, autoDraft, prices, contacts, setAutoDraft, onStage, refreshAuto, go, toast, t, showError]);

  const revokeAuto = useCallback(async () => {
    if (!ready || autoDraft.busy) return;
    setAutoDraft({ busy: true });
    sheetAmount.current = "";
    const res = await executeCalls({ api: ready.api, wallet: ready.wallet, onStage }, () => ready.api.revokePlan({ account: ready.account }));
    setAutoDraft({ busy: false });
    if (res.kind === "done") {
      void refreshAuto();
      toast(t.revokedToast);
      return go("home", { replace: true });
    }
    if (res.kind === "cancelled") return toast(t.toastCancelled);
    if (res.kind === "failed") return toast(res.reason === "unknown" ? t.unknownB : t.errGeneric);
    showError(res.code);
  }, [ready, autoDraft.busy, setAutoDraft, onStage, refreshAuto, toast, t, go, showError]);

  const setPaused = useCallback(
    async (paused: boolean) => {
      if (!ready) return;
      try {
        const r = await ready.api.autonomyPause(ready.account, paused);
        setAuto((a) => (a ? { ...a, paused: r.paused, operatorActive: a.configured && !r.paused } : a));
        toast(r.paused ? t.pausedToast : t.resumedToast);
        void refreshAuto();
      } catch (e) {
        showError((e as { code?: ClientErrorCode }).code ?? "network");
      }
    },
    [ready, toast, t, refreshAuto, showError],
  );

  // ── Chat ──
  const pushMsgs = useCallback((...m: ChatMsg[]) => setChat((c) => ({ ...c, msgs: [...c.msgs.filter((x) => x.kind !== "typing"), ...m] })), []);

  const chatRequest = useCallback(
    async (req: { text?: string; audioBase64?: string; audioMime?: string }, voiceMsgId?: string) => {
      if (!ready) return;
      setChat((c) => ({ ...c, busy: true, msgs: [...c.msgs, { id: newId(), kind: "typing" }] }));
      try {
        // Rules can name the phone's contacts that have a wallet (contacts live on the phone).
        const withWallet = contacts.filter((c) => c.address).map((c) => ({ name: c.name.slice(0, 40), address: c.address! }));
        const r = await ready.api.chat({ account: ready.account, lang, contacts: withWallet, ...req });
        setChat((c) => ({
          ...c,
          busy: false,
          msgs: [
            ...c.msgs.filter((x) => x.kind !== "typing").map((m) => (m.id === voiceMsgId && m.kind === "voice" ? { ...m, text: r.transcript } : m)),
            { id: newId(), kind: "bot", text: r.reply },
            ...r.quotes.map((q): ChatMsg => ({ id: newId(), kind: "quote", quote: q, at: Date.now(), status: "live" })),
            ...(r.rules ?? []).map((rule): ChatMsg => ({ id: newId(), kind: "rule", rule, status: "draft" })),
          ],
        }));
      } catch (e) {
        setChat((c) => ({ ...c, busy: false, msgs: [...c.msgs.filter((x) => x.kind !== "typing"), { id: newId(), kind: "bot", text: t.chatErr }] }));
        const code = (e as { code?: ClientErrorCode }).code;
        if (code === "rate_limited") toast(t.errRate);
      }
    },
    [ready, lang, t, toast, contacts],
  );

  const refreshRules = useCallback(() => {
    if (!ready || ready.mock) return setRules([]);
    ready.api.listRules(ready.account).then(
      (r) => setRules(r.rules.filter((x) => x.status !== "draft")),
      () => {},
    );
  }, [ready]);

  const setRuleMsg = (id: string, patch: Partial<Extract<ChatMsg, { kind: "rule" }>>) =>
    setChat((c) => ({ ...c, msgs: c.msgs.map((m) => (m.id === id && m.kind === "rule" ? { ...m, ...patch } : m)) }));

  const chatRuleConfirm = useCallback(
    async (msgId: string) => {
      if (!ready) return;
      const m = chat.msgs.find((x) => x.id === msgId);
      if (!m || m.kind !== "rule" || m.status !== "draft") return;
      setRuleMsg(msgId, { status: "busy" });
      try {
        const signature = await ready.wallet.signer.personalSign(m.rule.message);
        const rule = await ready.api.confirmRule({ ruleId: m.rule.ruleId, account: ready.account, signature });
        setRuleMsg(msgId, { status: "active", rule });
        pushMsgs({ id: newId(), kind: "bot", text: `${t.ruleOnT}. ${t.ruleOnB}` });
        refreshRules();
      } catch (e) {
        setRuleMsg(msgId, { status: "draft" });
        if (isUserRejection(e)) return;
        showError((e as { code?: ClientErrorCode }).code ?? "network");
      }
    },
    [ready, chat.msgs, pushMsgs, t, refreshRules, showError],
  );

  const cancelRule = useCallback(
    async (ruleId: string) => {
      if (!ready) return;
      try {
        const signature = await ready.wallet.signer.personalSign(cancelText(ruleId, ready.account as Address));
        await ready.api.cancelRule({ ruleId, account: ready.account, signature });
        setRules((rs) => (rs ?? []).filter((r) => r.ruleId !== ruleId));
        toast(t.ruleCancelled);
      } catch (e) {
        if (isUserRejection(e)) return;
        showError((e as { code?: ClientErrorCode }).code ?? "network");
      }
    },
    [ready, toast, t, showError],
  );

  const chatText = useCallback(
    (text: string) => {
      const s = text.trim();
      if (!s || chat.busy) return;
      pushMsgs({ id: newId(), kind: "user", text: s });
      void chatRequest({ text: s.slice(0, 1000) });
    },
    [chat.busy, pushMsgs, chatRequest],
  );

  const chatVoice = useCallback(
    async (blob: Blob, secs: number) => {
      const id = newId();
      pushMsgs({ id, kind: "voice", text: null, secs });
      const buf = new Uint8Array(await blob.arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      const audioBase64 = btoa(bin);
      if (audioBase64.length > 8_000_000) return toast(t.chatErr);
      void chatRequest({ audioBase64, audioMime: blob.type || "audio/webm" }, id);
    },
    [pushMsgs, chatRequest, toast, t],
  );

  const setChatQuote = (id: string, status: "live" | "used" | "cancelled" | "busy") =>
    setChat((c) => ({ ...c, msgs: c.msgs.map((m) => (m.id === id && m.kind === "quote" ? { ...m, status } : m)) }));

  const chatConfirm = useCallback(
    async (msgId: string) => {
      if (!ready) return;
      const m = chat.msgs.find((x) => x.id === msgId);
      if (!m || m.kind !== "quote" || m.status !== "live") return;
      const q = m.quote;
      setChatQuote(msgId, "busy");
      sheetAmount.current = `${fmtNumber(BigInt(q.amountIn), DECIMALS[q.from], lang)} ${q.from} → ${q.to}`;
      let procShown = false;
      const res = await executeQuote(
        {
          api: ready.api,
          wallet: ready.wallet,
          onStage: (s) => {
            if (s.stage === "sent" && !procShown) {
              procShown = true;
              setChatQuote(msgId, "used");
              pushMsgs({ id: newId(), kind: "proc", text: t.chatProc });
            }
          },
        },
        q.quoteId,
      );
      if (res.kind === "done") {
        const rid = res.receipt?.receiptId ?? null;
        if (rid) addReceipt({ receiptId: rid, kind: "change", at: new Date().toISOString() });
        setChatQuote(msgId, "used");
        const got = fmtSym(res.prepared?.expectedOut ?? q.expectedOut, q.to, lang);
        const pct = q.vsOfficial ? ` · ${fmtPct(q.vsOfficial.pct, lang)} ${t.vsOff}.` : ".";
        setChat((c) => ({
          ...c,
          msgs: [...c.msgs.filter((x) => x.kind !== "proc"), { id: newId(), kind: "done", title: fill(t.doneT, { x: got }), text: `${fill(t.doneSub, { y: fmtSym(q.amountIn, q.from, lang) })}${pct}`, receiptId: rid }],
        }));
        void refreshBalances();
        return;
      }
      if (res.kind === "cancelled") {
        setChatQuote(msgId, "cancelled");
        return pushMsgs({ id: newId(), kind: "cancel", quoteMsgId: msgId });
      }
      setChatQuote(msgId, res.kind === "failed" ? "used" : "live");
      setChat((c) => ({ ...c, msgs: c.msgs.filter((x) => x.kind !== "proc") }));
      if (res.kind === "failed") return pushMsgs({ id: newId(), kind: "bot", text: res.reason === "unknown" ? `${t.unknownT}. ${t.unknownB}` : res.reason === "not-sent" ? t.notSent : `${t.failedT}. ${t.noMoneyMoved}` });
      const mm = mapApiError(res.code);
      if (mm.kind === "expired") setChat((c) => ({ ...c, msgs: c.msgs.map((x) => (x.id === msgId && x.kind === "quote" ? { ...x, quote: { ...x.quote, expiresAt: new Date(0).toISOString() } } : x)) }));
      else if (mm.kind === "price-changed") pushMsgs({ id: newId(), kind: "bot", text: `${t.changed}. ${t.noMoneyMoved}` });
      else showError(res.code);
    },
    [ready, chat.msgs, lang, t, pushMsgs, addReceipt, refreshBalances, showError],
  );

  const chatCancel = useCallback(
    (msgId: string) => {
      setChatQuote(msgId, "cancelled");
      pushMsgs({ id: newId(), kind: "cancel", quoteMsgId: msgId });
    },
    [pushMsgs],
  );

  const chatRefresh = useCallback(
    async (msgId: string) => {
      if (!ready) return;
      const m = chat.msgs.find((x) => x.id === msgId);
      if (!m || m.kind !== "quote") return;
      const q = m.quote;
      const amount = amountOf(q);
      setChat((c) => ({ ...c, msgs: [...c.msgs, { id: newId(), kind: "typing" }] }));
      try {
        const q2 = await ready.api.quote({ from: q.from, to: q.to, amount, account: ready.account, lang });
        pushMsgs({ id: newId(), kind: "quote", quote: q2, at: Date.now(), status: "live" });
      } catch (e) {
        setChat((c) => ({ ...c, msgs: c.msgs.filter((x) => x.kind !== "typing") }));
        showError((e as { code?: ClientErrorCode }).code ?? "network");
      }
    },
    [ready, chat.msgs, lang, pushMsgs, showError],
  );

  const chatAlts = useCallback(
    (msgId: string) => {
      const m = chat.msgs.find((x) => x.id === msgId);
      if (!m || m.kind !== "quote") return;
      setCh({ quote: m.quote, quoteAt: m.at, from: m.quote.from, to: m.quote.to, prev: null });
      go("alts");
    },
    [chat.msgs, setCh, go],
  );

  // ── First screen (after ready) ──
  const firstScreenDone = useRef(false);
  useEffect(() => {
    if (!ready || firstScreenDone.current) return;
    firstScreenDone.current = true;
    const b = bootRef.current!;
    const l = lang;
    const mockContacts = ready.store.contacts(ready.account);
    void (async () => {
      if (ready.mock && b.state) {
        const s = STATE_ALIASES[b.state]?.screen ?? (isScreen(b.state) ? b.state : "home");
        await seedState(s, b);
        window.history.replaceState({ mp: s }, "");
        setScreen(s);
        return;
      }
      if (b.quoteId) {
        window.history.replaceState({ mp: "tg-quote" }, "");
        setScreen("tg-quote");
        // Show the quote it opens: the account's open quote when it matches, else GET /quote/:id (TODO(contract)).
        let q: Quote | null = null;
        try {
          const open = await ready.api.openQuote(ready.account);
          q = open && open.quoteId === b.quoteId ? open : await ready.api.quoteById(b.quoteId);
        } catch {
          q = null;
        }
        if (q) {
          setCh({ quote: q, quoteAt: Date.now(), from: q.from, to: q.to, prev: null });
          go("quote", { replace: true });
        }
        // Straight to prepare → MiniPay's sheet. The sheet is still the user's approval.
        void runQuote(q, b.quoteId);
        return;
      }
      // MiniPay's mini-app deeplink may drop ?quote=, so resume the account's open quote (from Telegram).
      // It opens on the quote card; the user confirms with one tap and MiniPay's sheet.
      try {
        const open = await ready.api.openQuote(ready.account);
        if (open && Date.parse(open.expiresAt) > Date.now() + 3_000) {
          ready.store.setOnboarded(ready.account);
          setCh({ quote: open, quoteAt: Date.now(), from: open.from, to: open.to, prev: null, amount: amountOf(open) });
          window.history.replaceState({ mp: "home" }, "");
          setScreen("home");
          go("quote");
          return;
        }
      } catch {
        /* no open quote (or endpoint not deployed yet): normal launch */
      }
      const pr = ready.store.pendingRipio(ready.account);
      const first: Screen = pr && Date.now() - pr.at < 30 * 60_000 ? "add-waiting" : ready.store.onboarded(ready.account) ? "home" : "welcome";
      window.history.replaceState({ mp: first }, "");
      setScreen(first);
    })();

    async function seedState(s: Screen, b: Boot) {
      if (!ready) return;
      const api = ready.api;
      const pers = l === "pt" ? { from: "wBRL" as const, to: "wARS" as const, amt: "200" } : { from: "wBRL" as const, to: "wARS" as const, amt: "10" };
      setCh({ from: pers.from, to: pers.to, amount: pers.amt });
      const needQuote = ["quote", "quote-expired", "quote-changed", "alts", "processing", "done", "failed", "cancelled"].includes(s);
      if (needQuote) {
        const q = await api.quote({ from: pers.from, to: pers.to, amount: pers.amt, account: ready.account, lang: l });
        if (s === "quote-expired") setCh({ quote: { ...q, expiresAt: new Date(Date.now() - 1000).toISOString() }, quoteAt: Date.now() - 48_000 });
        else if (s === "quote-changed") {
          const lower = (BigInt(q.expectedOut) * 9977n) / 10000n;
          setCh({ prev: q, quote: { ...q, expectedOut: lower.toString(), minOut: ((lower * 995n) / 1000n).toString() }, quoteAt: Date.now() });
        } else setCh({ quote: q, quoteAt: Date.now() });
        const base: ExecState = { ...EMPTY_EXEC, from: q.from, to: q.to, amountIn: q.amountIn, expectedOut: q.expectedOut };
        if (s === "processing") setExec({ ...base, stage: { stage: "sent", index: 1, total: 2, hash: "0x00" }, total: 2 });
        if (s === "done") setExec({ ...base, receiptId: ready.store.receipts(ready.account)[0]?.receiptId ?? null, result: { kind: "done", prepared: null, hashes: [], receipt: null } });
        if (s === "failed") setExec({ ...base, result: { kind: "failed", reason: "reverted", hashes: [] } });
        if (s === "cancelled") setExec({ ...base, result: { kind: "cancelled" } });
      }
      if (s.startsWith("send-")) {
        const c = mockContacts[0];
        if (c) setSendState({ contactId: c.id, pay: "USD", amount: "20", quote: null, quoteAt: 0, busy: false });
        if (c && (s === "send-quote" || s === "send-done")) {
          const q = c.cur === "USD" ? null : await api.quote({ from: "USDT", to: SYM_OF[c.cur], amount: "20", account: ready.account, lang: l });
          setSendState({ contactId: c.id, pay: "USD", amount: "20", quote: q, quoteAt: Date.now(), busy: false });
          if (s === "send-done") setExec({ ...EMPTY_EXEC, flow: "send", from: "USDT", to: SYM_OF[c.cur], amountIn: q?.amountIn ?? "20000000", expectedOut: q?.expectedOut ?? "20000000", contactName: c.name.split(" ")[0] ?? c.name, receiptId: ready.store.receipts(ready.account)[1]?.receiptId ?? null });
        }
      }
      if (s === "auto-contacts" || s === "auto-consent" || s === "auto-on") setAutoDraftState({ preset: "mid", contactIds: mockContacts.slice(0, 2).map((c) => c.id), busy: false });
      if (s === "receipt") setReceiptId(ready.store.receipts(ready.account)[0]?.receiptId ?? null);
      if (s === "chat") seedChat(b.chat ?? "quote");
    }

    function seedChat(stage: string) {
      if (!ready) return;
      const tt = miniT(l);
      const from = l === "pt" ? ("wBRL" as const) : ("USDT" as const);
      const amt = l === "pt" ? "200" : "100";
      if (stage === "empty") return;
      if (stage === "rec") return setChat((c) => ({ ...c, recording: true }));
      void (async () => {
        const voice: ChatMsg = { id: newId(), kind: "voice", text: `“${tt.chatAsk}”`, secs: 3 };
        if (stage === "typing") return setChat((c) => ({ ...c, msgs: [voice, { id: newId(), kind: "typing" }] }));
        const q = await ready.api.quote({ from, to: "wARS", amount: amt, account: ready.account, lang: l });
        const qid = newId();
        const quoteMsg: ChatMsg = { id: qid, kind: "quote", quote: stage === "expired" ? { ...q, expiresAt: new Date(0).toISOString() } : q, at: Date.now(), status: stage === "proc" || stage === "done" ? "used" : stage === "cancel" ? "cancelled" : "live" };
        const msgs: ChatMsg[] = [voice, quoteMsg];
        if (stage === "proc") msgs.push({ id: newId(), kind: "proc", text: tt.chatProc });
        if (stage === "done")
          msgs.push({ id: newId(), kind: "done", title: fill(tt.doneT, { x: fmtSym(q.expectedOut, "wARS", l) }), text: `${fill(tt.doneSub, { y: fmtSym(q.amountIn, from, l) })} · ${q.vsOfficial ? fmtPct(q.vsOfficial.pct, l) : ""} ${tt.vsOff}.`, receiptId: ready.store.receipts(ready.account)[0]?.receiptId ?? null });
        if (stage === "cancel") msgs.push({ id: newId(), kind: "cancel", quoteMsgId: qid });
        setChat((c) => ({ ...c, msgs }));
      })();
    }
  }, [ready, lang, go, runQuote, setCh]);

  // ── Render ──
  if (env.phase === "boot") return <div className="mp-root" aria-busy="true" />;
  if (env.phase === "no-minipay" || env.phase === "conn-fail")
    return (
      <div className="mp-root">
        <div className="mp-app" lang={lang}>
          <Gate kind={env.phase} t={t} linkCode={mode === "link" ? codeFromUrl() : null} onRetry={() => { setEnv({ phase: "boot" }); void boot(); }} />
        </div>
      </div>
    );

  const contactSave = (c: Contact) => {
    env.store.saveContact(env.account, c);
    setContacts(env.store.contacts(env.account));
  };

  const app: AppCtx = {
    t,
    lang,
    setLang,
    mock: env.mock,
    account: env.account,
    api: env.api,
    wallet: env.wallet,
    store: env.store,
    persona: env.persona,
    displayCur: DISPLAY_CUR[lang] as Cur,
    screen,
    go,
    back,
    toast,
    showError,
    setSheet,
    openLink,
    bal,
    rates,
    prices,
    refreshBalances: () => void refreshBalances(),
    auto,
    refreshAuto: () => void refreshAuto(),
    receipts,
    contacts,
    saveContact: contactSave,
    finishOnboarding: (next) => {
      env.store.setOnboarded(env.account);
      go(next);
    },
    startRipio: (sym) => {
      const before = (bal.data?.balances.find((b) => b.sym === sym)?.amount ?? "0").toString();
      env.store.setPendingRipio(env.account, { at: Date.now(), sym, before });
      const country = sym === "wBRL" ? "BR" : "AR";
      const url = `https://ramp.ripio.com/?country=${country}&chain=42220&token=${sym === "wBRL" ? "WBRL" : "WARS"}&address=${env.account}`;
      if (env.mock) {
        toast(t.toastMP.replace("MiniPay", "Ripio"));
        go("add-waiting");
        return;
      }
      go("add-waiting");
      openLink(url);
    },
    ch,
    setCh,
    requestQuote: () => void requestQuote(),
    confirmQuote,
    exec,
    send,
    setSend,
    requestSendQuote: () => void requestSendQuote(),
    confirmSend: () => void confirmSend(),
    autoDraft,
    setAutoDraft,
    activateAuto: () => void activateAuto(),
    revokeAuto: () => void revokeAuto(),
    setPaused: (p) => void setPaused(p),
    receiptId,
    openReceipt: (id) => {
      setReceiptId(id);
      go("receipt");
    },
    chat,
    chatText,
    chatVoice: (b, s) => void chatVoice(b, s),
    setRecording: (r) => setChat((c) => ({ ...c, recording: r })),
    chatConfirm: (id) => void chatConfirm(id),
    chatCancel,
    chatRefresh: (id) => void chatRefresh(id),
    chatRuleConfirm: (id) => void chatRuleConfirm(id),
    rules,
    refreshRules,
    cancelRule: (id) => void cancelRule(id),
    chatAlts,
  };

  const head = HEADER[screen];
  const title = head ? (head[0] === "sendTo" ? fill(t.hSendTo, { n: (sendContact?.name ?? "").split(" ")[0] ?? "" }) : t[head[0]]) : null;
  const showTabs = mode === "app" && TAB_SCREENS.includes(screen);

  return (
    <AppContext.Provider value={app}>
      <div className="mp-root">
        <div className="mp-app" lang={lang === "es" ? "es-AR" : lang === "pt" ? "pt-BR" : "en"}>
          {mode === "link" ? (
            <LinkScreen />
          ) : (
            <>
              {title ? <Header title={title} step={STEP[screen]} onBack={back} backLabel={t.back} /> : null}
              <ScreenView screen={screen} />
              {showTabs ? (
                <nav className="mp-tabs" aria-label="Arbolito">
                  {TABS.map((tb) => (
                    <button key={tb.screen} type="button" aria-current={tb.screen === screen ? "page" : undefined} onClick={() => tb.screen !== screen && go(tb.screen)}>
                      {t[tb.key]}
                    </button>
                  ))}
                </nav>
              ) : null}
            </>
          )}
          {toastMsg ? (
            <div className="mp-toast" role="status">
              {toastMsg}
            </div>
          ) : null}
          {sheet === "lang" ? <LangSheet /> : null}
          {sheet === "details" ? <DetailsSheet /> : null}
          {mpReq ? (
            <MiniPaySheet
              req={mpReq.req}
              amount={sheetAmount.current}
              onAnswer={(ok) => {
                mpReq.resolve(ok);
                setMpReq(null);
              }}
            />
          ) : null}
        </div>
      </div>
    </AppContext.Provider>
  );
}
