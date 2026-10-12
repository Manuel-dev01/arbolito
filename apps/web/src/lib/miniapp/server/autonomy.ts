import { encodeFunctionData, type Address, type Hex } from "viem";
import type { z } from "zod";
import { CONTRACTS, POOLS, TOKENS } from "@arbolito/config";
import {
  GUARD_V2_MAX_SLIPPAGE_BPS,
  arbolitoGuardAbi,
  encodeGuardV2Configure,
  encodeGuardV2RevokeOperator,
  encodeGuardV2SetOperator,
  readGuardV2Budget,
  readGuardV2Operator,
  readGuardV2Settings,
  withAttribution,
} from "@arbolito/chain";
import { erc20Abi } from "@arbolito/router";
import { SYMBOLS, type AutonomyPlanRequest, type AutonomyStatus, type CallsResponse, type RevokePlanRequest } from "../contract";
import type { MiniappDeps } from "./deps";
import { badRequest, notReady, upstream } from "./errors";
import { logError } from "./http";

/**
 * "Dejá que Arbolito actúe por vos" via ArbolitoGuard v2. The server only encodes calls; the
 * account's own wallet sends them, so every setting is the user's own transaction.
 */

const U128_MAX = (1n << 128n) - 1n;
const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
/** RecipientSet lookback for the contacts list (~30 days of 1 s Celo blocks). */
const CONTACT_LOOKBACK_BLOCKS = 2_600_000n;

function guardOf(deps: MiniappDeps) {
  if (!deps.guard) throw notReady("Autonomy is not available yet (the guard is not deployed).");
  return deps.guard;
}

function tag(deps: MiniappDeps, to: Address, data: Hex, label: string) {
  if (!deps.attributionCode) throw notReady("ATTRIBUTION_CODE is not configured; every transaction must carry it.");
  return { to, data: withAttribution(data, deps.attributionCode), value: "0", label };
}

/** Contacts the guard currently allows, replayed from RecipientSet events (best effort). */
async function readContacts(deps: MiniappDeps, guard: Address, account: Address): Promise<Address[]> {
  try {
    const latest = await deps.chain.getBlockNumber();
    const logs = await deps.chain.getLogs({
      address: guard,
      event: arbolitoGuardAbi.find((x) => x.type === "event" && x.name === "RecipientSet")!,
      args: { account },
      fromBlock: latest > CONTACT_LOOKBACK_BLOCKS ? latest - CONTACT_LOOKBACK_BLOCKS : 0n,
      toBlock: latest,
    });
    const allowed = new Map<string, Address>();
    for (const l of logs as unknown as { args: { recipient: Address; allowed: boolean } }[]) {
      if (l.args.allowed) allowed.set(l.args.recipient.toLowerCase(), l.args.recipient);
      else allowed.delete(l.args.recipient.toLowerCase());
    }
    return [...allowed.values()];
  } catch (err) {
    logError("autonomy contacts", err);
    return [];
  }
}

/** GET /autonomy/status?account= */
export async function autonomyStatus(deps: MiniappDeps, account: Address): Promise<z.infer<typeof AutonomyStatus>> {
  const guard = guardOf(deps);
  try {
    const [settings, op, budgets, contacts] = await Promise.all([
      readGuardV2Settings(deps.chain, guard.address, account),
      readGuardV2Operator(deps.chain, guard.address, account),
      Promise.all(SYMBOLS.map(async (sym) => ({ sym, b: await readGuardV2Budget(deps.chain, guard.address, account, TOKENS[sym].address) }))),
      readContacts(deps, guard.address, account),
    ]);
    return {
      account,
      configured: settings.configured,
      paused: settings.paused,
      operatorActive: op.active && eq(op.operator, guard.operator),
      operatorExpiry: op.expiry > 0n ? new Date(Number(op.expiry) * 1000).toISOString() : null,
      maxSlippageBps: settings.maxSlippageBps,
      limits: budgets
        .filter(({ b }) => b.maxPerTx > 0n || b.maxPerDay > 0n)
        .map(({ sym, b }) => ({ sym, perTx: b.maxPerTx.toString(), perDay: b.maxPerDay.toString(), spentToday: b.spentToday.toString() })),
      contacts,
    };
  } catch (err) {
    logError("autonomy status", err);
    throw upstream("Could not read the autonomy settings from the network.");
  }
}

/** Mirrors the guard's configure() recipient checks so the user never signs a tx that reverts. */
function checkContact(c: Address, account: Address, guard: Address) {
  const banned = [
    "0x0000000000000000000000000000000000000000",
    account,
    guard,
    CONTRACTS.uniswap.swapRouter02,
    ...SYMBOLS.map((s) => TOKENS[s].address),
    ...POOLS.filter((p) => p.routable).map((p) => p.address),
  ];
  if (banned.some((b) => eq(b, c))) throw badRequest(`${c} can't be an autonomy contact.`);
}

/** POST /autonomy/plan → bounded approvals to the guard, setOperator, configure. */
export async function autonomyPlan(deps: MiniappDeps, req: z.infer<typeof AutonomyPlanRequest>): Promise<z.infer<typeof CallsResponse>> {
  const guard = guardOf(deps);
  const account = req.account.toLowerCase() as Address;
  if (req.maxSlippageBps > GUARD_V2_MAX_SLIPPAGE_BPS) throw badRequest(`maxSlippageBps must be at most ${GUARD_V2_MAX_SLIPPAGE_BPS}.`);
  const seen = new Set<string>();
  const limits = req.limits.map((l) => {
    if (seen.has(l.sym)) throw badRequest(`${l.sym} appears twice in limits.`);
    seen.add(l.sym);
    const perTx = BigInt(l.perTx);
    const perDay = BigInt(l.perDay);
    if (perDay === 0n || perTx === 0n) throw badRequest(`${l.sym} limits must be greater than zero.`);
    if (perTx > perDay) throw badRequest(`${l.sym} per-transaction limit is above the daily limit.`);
    if (perDay > U128_MAX) throw badRequest(`${l.sym} limit is too large.`);
    return { sym: l.sym, token: TOKENS[l.sym].address as Address, maxPerTx: perTx, maxPerDay: perDay };
  });
  const contacts = [...new Map(req.contacts.map((c) => [c.toLowerCase(), c as Address])).values()];
  for (const c of contacts) checkContact(c, account, guard.address);

  const expiry = BigInt(Math.floor(deps.now() / 1000) + req.operatorDays * 86_400);
  const calls = [
    // The allowance is the hard ceiling on what the guard can ever move: one day's worth.
    ...limits.map((l) =>
      tag(deps, l.token, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [guard.address, l.maxPerDay] }), `approve ${l.sym} to ArbolitoGuard`),
    ),
    tag(deps, guard.address, encodeGuardV2SetOperator(guard.operator, expiry), "ArbolitoGuard.setOperator"),
    tag(
      deps,
      guard.address,
      encodeGuardV2Configure({
        account,
        paused: false,
        maxSlippageBps: req.maxSlippageBps,
        limits: limits.map(({ token, maxPerTx, maxPerDay }) => ({ token, maxPerTx, maxPerDay })),
        recipients: contacts.map((recipient) => ({ recipient, allowed: true })),
        prices: [],
      }),
      "ArbolitoGuard.configure",
    ),
  ];
  return { calls };
}

/** POST /autonomy/revoke-plan → revokeOperator + approvals back to 0 (tokens with a live allowance). */
export async function autonomyRevokePlan(deps: MiniappDeps, req: z.infer<typeof RevokePlanRequest>): Promise<z.infer<typeof CallsResponse>> {
  const guard = guardOf(deps);
  const account = req.account.toLowerCase() as Address;
  let syms: readonly (typeof SYMBOLS)[number][] = SYMBOLS;
  try {
    const allowances = (await deps.chain.multicall({
      allowFailure: false,
      contracts: SYMBOLS.map((s) => ({ address: TOKENS[s].address, abi: erc20Abi, functionName: "allowance", args: [account, guard.address] }) as const),
    })) as bigint[];
    syms = SYMBOLS.filter((_, i) => (allowances[i] ?? 0n) > 0n);
  } catch (err) {
    // Can't tell which are live: reset all five (a zero approve is harmless).
    logError("autonomy revoke allowances", err);
  }
  return {
    calls: [
      tag(deps, guard.address, encodeGuardV2RevokeOperator(), "ArbolitoGuard.revokeOperator"),
      ...syms.map((s) =>
        tag(deps, TOKENS[s].address, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [guard.address, 0n] }), `approve ${s} to ArbolitoGuard: 0`),
      ),
    ],
  };
}
