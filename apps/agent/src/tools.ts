import type { Address } from "viem";
import { TOKENS, loadEnv, tokenByAddress, type TokenSymbol } from "@arbolito/config";
import { formatUsd } from "@arbolito/chain";
import { effectiveRate, erc20Abi, fiatOf, fmtAmount, referenceRate } from "@arbolito/router";
import { TOKEN_SYMBOLS, ToolUserError, type AgentCard, type ToolHandlers } from "@arbolito/llm";
import { NoRouteError, quote } from "./quotes";
import { rampLink } from "./ripio";
import { serializeRoute } from "./serde";
import type { Services } from "./services";
import { addContact, createPending, findContact, getReceipt, listContacts, type User } from "./store";

/** How long a quote card stays confirmable. */
export const QUOTE_TTL_MS = 60_000;

const NO_WALLET = "The user has no wallet yet. They create it in the Arbolito app (Mini App); until then nothing can be checked or moved.";

function summarize(q: Awaited<ReturnType<typeof quote>>) {
  const r = q.route;
  const [base, qt] = [fiatOf(tokenByAddress(r.tokenIn).symbol), fiatOf(tokenByAddress(r.tokenOut).symbol)];
  const rate = effectiveRate(r.tokenIn, r.amountIn, r.tokenOut, r.expectedOut);
  const official = referenceRate(q.references, "official", base, qt);
  return {
    youPay: fmtAmount(r.tokenIn, r.amountIn),
    youGet: fmtAmount(r.tokenOut, r.expectedOut),
    guaranteedMinimum: fmtAmount(r.tokenOut, r.minOut),
    rate: `1 ${base} = ${rate.toPrecision(6)} ${qt}`,
    vsOfficialPercent: official ? Number(((rate / official - 1) * 100).toFixed(2)) : null,
    route: r.label,
    alternativesConsidered: q.alternatives.length,
  };
}


/** Tool handlers bound to one user. Nothing here moves funds: prepare_* only create a card to confirm. */
export function buildHandlers(s: Services, user: User): ToolHandlers {
  const env = loadEnv();
  const base = (env.PUBLIC_BASE_URL ?? "").replace(/\/$/, "");

  return {
    async get_balances() {
      if (!user.walletAddress) throw new ToolUserError(NO_WALLET, "no_wallet");
      const owner = user.walletAddress as Address;
      const results = await s.chain.multicall({
        allowFailure: true,
        contracts: TOKEN_SYMBOLS.map((sym) => ({ address: TOKENS[sym].address, abi: erc20Abi, functionName: "balanceOf", args: [owner] }) as const),
      });
      const balances = TOKEN_SYMBOLS.map((sym, i) => {
        const r = results[i];
        return { token: sym, amount: r?.status === "success" ? fmtAmount(TOKENS[sym].address, r.result as bigint) : "unavailable" };
      });
      return { data: { wallet: owner, balances } };
    },

    async get_quote(args) {
      try {
        return { data: summarize(await quote(s, args.from, args.to, args.amount, user.walletAddress)) };
      } catch (err) {
        if (err instanceof NoRouteError) throw new ToolUserError("No market can quote that pair and size right now.", "no_route");
        throw err;
      }
    },

    async prepare_convert(args) {
      let q;
      try {
        q = await quote(s, args.from, args.to, args.amount, user.walletAddress);
      } catch (err) {
        if (err instanceof NoRouteError) throw new ToolUserError("No market can quote that pair and size right now.", "no_route");
        throw err;
      }
      const pending = await createPending(
        s.db,
        user.id,
        "convert",
        { route: serializeRoute(q.route), alternatives: q.alternatives.slice(0, 5).map(serializeRoute), references: q.references as never },
        QUOTE_TTL_MS,
      );
      const card: AgentCard = { kind: "convert", id: pending.id };
      return {
        data: { status: "pending_confirmation", note: "A card with Confirm/Cancel buttons is shown to the user. Nothing has moved.", ...summarize(q) },
        card,
      };
    },

    async prepare_send(args) {
      const contact = args.recipient.startsWith("0x") ? null : await findContact(s.db, user.id, args.recipient);
      const to = args.recipient.startsWith("0x") ? args.recipient : contact?.address;
      if (!to) throw new ToolUserError(`No saved contact named "${args.recipient}". Ask the user for the address and save it with add_contact.`, "unknown_contact");
      const destination = (args.destinationToken ?? args.token) as TokenSymbol;
      let payload: Record<string, unknown> = { to, token: args.token, amount: args.amount, contactName: contact?.name ?? null };
      let summary: Record<string, unknown> = { recipient: contact?.name ?? to, amount: `${args.amount} ${args.token}` };
      if (destination !== args.token) {
        let q;
        try {
          q = await quote(s, args.token, destination, args.amount, user.walletAddress);
        } catch (err) {
          if (err instanceof NoRouteError) throw new ToolUserError("No market can convert that amount for the send right now.", "no_route");
          throw err;
        }
        payload = { ...payload, route: serializeRoute(q.route), references: q.references as never };
        summary = { ...summary, recipientGets: fmtAmount(q.route.tokenOut, q.route.expectedOut), ...summarize(q) };
      }
      const pending = await createPending(s.db, user.id, "send", payload as never, QUOTE_TTL_MS);
      return {
        data: { status: "pending_confirmation", note: "A card with Confirm/Cancel buttons is shown to the user. Nothing has moved.", ...summary },
        card: { kind: "send", id: pending.id },
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
      return {
        data: {
          perAction: formatUsd(BigInt(user.maxActionMicros)),
          perDay: formatUsd(BigInt(user.maxDailyMicros)),
          note: "Limits change only in the Arbolito app, never in chat.",
        },
      };
    },

    async deposit_info(args) {
      if (!user.walletAddress) throw new ToolUserError(NO_WALLET, "no_wallet");
      const tokens = args.token ? [args.token] : (["wARS", "wBRL", "USDT"] as const);
      return {
        data: {
          address: user.walletAddress,
          network: "Celo",
          ripio: tokens.map((t) => ({ token: t, link: rampLink({ direction: "on", token: t, address: user.walletAddress! }) })),
          other: "USDT, USDC or USA₮ can also be sent to this address on the Celo network.",
        },
      };
    },

    async withdraw_guide(args) {
      if (!user.walletAddress) throw new ToolUserError(NO_WALLET, "no_wallet");
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
          can: ["check balances", "quote and convert pesos, reais and dollars", "send to saved contacts, converting if needed", "show receipts", "deposit and cash-out links via Ripio"],
          tokens: TOKEN_SYMBOLS,
        },
      };
    },
  };
}
