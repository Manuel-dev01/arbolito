import type { Address } from "viem";
import { TOKENS, loadEnv } from "@arbolito/config";
import { formatUsd, readGuardV2Budget } from "@arbolito/chain";
import { erc20Abi, fmtAmount } from "@arbolito/router";
import { TOKEN_SYMBOLS, ToolUserError, type AgentCard, type ToolHandlers, type ToolOutput } from "@arbolito/llm";
import { MiniAppApiError } from "./api";
import type { QuoteResponse } from "./contract";
import type { CardFlow, CreateResult } from "./flow";
import { copy, type Lang } from "./i18n";
import { maskWallet, money, rateLine } from "./money";
import { rampLink } from "./ripio";
import type { Services } from "./services";
import { addContact, findContact, getReceipt, listContacts, type User } from "./store";

/** Card kinds the bot renders after the reply, besides "convert" and "send" (pending ids). */
export const LINK_CARD: AgentCard = { kind: "link", id: "link" };
export const noMarketCard = (from: string, to: string, amount: string): AgentCard => ({ kind: "no_market", id: "-", data: { from, to, amount } });

/** Unlinked user asked for something that needs their wallet: show the linking prompt. */
const NOT_LINKED: ToolOutput = {
  data: {
    status: "not_linked",
    note: "The user hasn't connected their MiniPay wallet yet. A 'Conectá tu MiniPay' button is shown below your reply; it takes one tap and a 4-digit code. Nothing can be checked or moved until then.",
  },
  card: LINK_CARD,
};

const CONFIRM_NOTE = "A card is shown with a 'Confirmar en MiniPay' button that opens the Arbolito mini app at this exact quote. The user confirms there, in their own MiniPay wallet. Nothing has moved. The quote expires in about a minute.";

function summarize(q: QuoteResponse, lang: Lang) {
  return {
    youPay: money(q.from, q.amountIn, lang),
    youGet: money(q.to, q.expectedOut, lang),
    guaranteedMinimum: money(q.to, q.minOut, lang),
    rate: rateLine(q.from, q.to, q.rate, lang),
    vsOfficialPercent: q.vsOfficial ? q.vsOfficial.pct : null,
    route: copy.route(lang, q.steps),
    alternativesConsidered: q.alternatives.length,
    expiresInSeconds: Math.max(0, Math.round((Date.parse(q.expiresAt) - Date.now()) / 1000)),
  };
}

/** A failed quote, as the model should see it. no_route also gets the "no market" card. */
function quoteFailure(r: Extract<CreateResult, { ok: false }>, from: string, to: string, amount: string): ToolOutput {
  if (r.error === "noMarket") {
    return { data: { status: "no_route", note: "No market can quote this pair and size right now. A message saying so, with a retry button, is shown. Nothing moved." }, card: noMarketCard(from, to, amount) };
  }
  const why = r.error === "rateLimited" ? "Too many quotes in a short time; ask the user to wait a minute." : r.error === "quoteBad" ? "The backend rejected the amount or pair." : "The quote service failed. Nothing moved.";
  throw new ToolUserError(why, r.error);
}

/** Tool handlers bound to one user. Nothing here moves funds: prepare_* only create a card. */
export function buildHandlers(s: Services, flow: CardFlow, user: User): ToolHandlers {
  const base = (s.baseUrl ?? "").replace(/\/$/, "");

  return {
    async get_balances() {
      if (!user.walletAddress) return NOT_LINKED;
      const owner = user.walletAddress as Address;
      const results = await s.chain.multicall({
        allowFailure: true,
        contracts: TOKEN_SYMBOLS.map((sym) => ({ address: TOKENS[sym].address, abi: erc20Abi, functionName: "balanceOf", args: [owner] }) as const),
      });
      const balances = TOKEN_SYMBOLS.map((sym, i) => {
        const r = results[i];
        return { token: sym, amount: r?.status === "success" ? fmtAmount(TOKENS[sym].address, r.result as bigint) : "unavailable" };
      });
      return { data: { wallet: `linked MiniPay ${maskWallet(owner)}`, balances } };
    },

    async get_quote(args, ctx) {
      try {
        const q = await s.miniapp.quote({ from: args.from, to: args.to, amount: args.amount, lang: ctx.language, ...(user.walletAddress ? { account: user.walletAddress } : {}) });
        return { data: summarize(q, ctx.language) };
      } catch (err) {
        if (err instanceof MiniAppApiError && err.code === "no_route") throw new ToolUserError("No market can quote that pair and size right now.", "no_route");
        if (err instanceof MiniAppApiError && err.code === "rate_limited") throw new ToolUserError("Too many quotes in a short time; ask the user to wait a minute.", "rate_limited");
        throw err;
      }
    },

    async prepare_convert(args, ctx) {
      const r = await flow.createConvert(user, ctx.language, { kind: "convert", from: args.from, to: args.to, amount: args.amount });
      if (!r.ok) return quoteFailure(r, args.from, args.to, args.amount);
      return { data: { status: "pending_confirmation", note: CONFIRM_NOTE, ...summarize(r.quote!, ctx.language) }, card: { kind: "convert", id: r.pendingId } };
    },

    async prepare_send(args, ctx) {
      const contact = args.recipient.startsWith("0x") ? null : await findContact(s.db, user.id, args.recipient);
      const to = args.recipient.startsWith("0x") ? args.recipient : contact?.address;
      if (!to) throw new ToolUserError(`No saved contact named "${args.recipient}". Ask the user for the address and save it with add_contact.`, "unknown_contact");
      const receive = args.destinationToken && args.destinationToken !== args.token ? args.destinationToken : undefined;
      const r = await flow.createSend(user, ctx.language, {
        kind: "send",
        recipient: contact?.name ?? to,
        to,
        amount: args.amount,
        token: args.token,
        ...(receive ? { receive } : {}),
      });
      if (!r.ok) return quoteFailure(r, args.token, receive ?? args.token, args.amount);
      const summary: Record<string, unknown> = { recipient: contact?.name ?? to, amount: `${args.amount} ${args.token}` };
      if (r.quote) Object.assign(summary, { recipientGets: money(r.quote.to, r.quote.expectedOut, ctx.language), ...summarize(r.quote, ctx.language) });
      return {
        data: { status: "pending_confirmation", note: "A card is shown with a 'Confirmar en MiniPay' button that opens the Arbolito mini app's send screen, prefilled. The user reviews and confirms there. Nothing has moved.", ...summary },
        card: { kind: "send", id: r.pendingId },
      };
    },

    async add_contact(args) {
      const row = await addContact(s.db, user.id, args.name, args.address);
      return { data: { saved: true, name: row.name, address: row.address } };
    },

    async list_contacts() {
      const rows = await listContacts(s.db, user.id);
      return { data: { contacts: rows.map((c) => ({ name: c.name, address: c.address })) } };
    },

    async get_receipt(args) {
      const row = await getReceipt(s.db, user.id, args.id);
      if (!row) throw new ToolUserError("No receipt found for this user with that id.", "no_receipt");
      return {
        data: {
          id: row.id,
          pay: fmtAmount(row.tokenIn as Address, BigInt(row.amountIn)),
          got: fmtAmount(row.tokenOut as Address, BigInt(row.amountOut)),
          savingsBps: row.savingsBps,
          link: base ? `${base}/r/${row.id}` : null,
          executionTx: row.executionTx,
        },
      };
    },

    async get_limits() {
      // The only limits are the user's own: none on conversions they confirm, and the ones they
      // signed into ArbolitoGuard for automatic rules. Arbolito sets no cap of its own.
      const guard = loadEnv().GUARD_ADDRESS as Address | undefined;
      const budget = user.walletAddress && guard ? await readGuardV2Budget(s.chain, guard, user.walletAddress as Address, TOKENS.USDT.address as Address).catch(() => null) : null;
      return {
        data: {
          conversions: "No limit from Arbolito on conversions the user confirms in MiniPay; only what the market can fill.",
          automaticRules:
            budget && budget.maxPerDay > 0n
              ? { perOperation: formatUsd(budget.maxPerTx), perDay: formatUsd(budget.maxPerDay), usedToday: formatUsd(budget.spentToday), setBy: "the user, onchain" }
              : "Off. The user picks their own limits when turning on automatic rules in the app.",
          note: "Limits change only in the Arbolito app, never in chat.",
        },
      };
    },

    async deposit_info(args) {
      if (!user.walletAddress) return NOT_LINKED;
      const tokens = args.token ? [args.token] : (["wARS", "wBRL", "USDT"] as const);
      return {
        data: {
          address: user.walletAddress,
          network: "Celo",
          ripio: tokens.map((t) => ({ token: t, link: rampLink({ direction: "on", token: t, address: user.walletAddress! }) })),
          other: "USDT, USDC or USA₮ can also be sent to this MiniPay address on the Celo network.",
        },
      };
    },

    async withdraw_guide(args) {
      if (!user.walletAddress) return NOT_LINKED;
      const token = args.token ?? "wARS";
      return {
        data: {
          ripioOffRamp: rampLink({ direction: "off", token, address: user.walletAddress }),
          steps: "Open the link; Ripio handles identity checks and pays out to the user's local bank account.",
        },
      };
    },

    async help() {
      return {
        data: {
          can: ["check balances of the linked MiniPay wallet", "quote and convert pesos, reais and dollars (confirmed in MiniPay)", "send to saved contacts, converting if needed (confirmed in MiniPay)", "show receipts", "deposit and cash-out links via Ripio", "voice notes"],
          tokens: TOKEN_SYMBOLS,
          linked: !!user.walletAddress,
        },
      };
    },
  };
}
