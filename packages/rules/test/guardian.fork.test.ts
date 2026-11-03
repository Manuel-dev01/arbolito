/**
 * The peso guardian against the deployed ArbolitoGuard v2 on a Celo fork. A fresh account holding
 * only USDT sets the guard up, then the runner evaluates a wARS guardian with the operator key:
 * while the peso gains, it moves dollars back into pesos down to the target, in pieces within the
 * limits; when the peso starts losing value, it moves pesos to dollars. Each direction runs at most
 * once a day, and a desk breaker holds it.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, inject, it } from "vitest";
import { createTestClient, createWalletClient, encodeFunctionData, http, parseAbi, parseEther, type Address, type Hex, type PublicClient, type WalletClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { POOLS, TOKENS } from "@arbolito/config";
import { MemoryLedger, celoMainnet, encodeGuardV2Configure, encodeGuardV2SetOperator, isAnvil, makePublicClient, makeWalletClient, sendGuarded } from "@arbolito/chain";
import type { GuardianSignal } from "../src/index";
import { RulesRunner, type RunnerStore, type StoredRule } from "../src/runner";

const GUARD = "0x411E44dB70476F74C3560F5cCFdbc8c63f231d33" as Address; // mainnet deployment (docs/04-reference.md)
const USDT = TOKENS.USDT.address as Address;
const WARS = TOKENS.wARS.address as Address;
const WARS_POOL = POOLS.find((p) => p.name.startsWith("wARS/USDT"))!.address as Address;
const USER = privateKeyToAccount(generatePrivateKey());
const OPERATOR = privateKeyToAccount(generatePrivateKey());
const erc20 = parseAbi(["function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)", "function transfer(address,uint256) returns (bool)"]);

class MemStore implements RunnerStore {
  rules = new Map<string, StoredRule & { status: string }>();
  runs: { id: string; ruleId: string; trigger: string; status: string; amountOut?: bigint | null; txHashes: string[]; error?: string | null }[] = [];
  async dueSendRules() {
    return [];
  }
  async activeSplitRules() {
    return [];
  }
  async activeGuardianRules() {
    return [...this.rules.values()].filter((r) => r.status === "active" && r.kind === "guardian");
  }
  async claimRun(ruleId: string, trigger: string) {
    if (this.runs.some((x) => x.ruleId === ruleId && x.trigger === trigger)) return null;
    const run = { id: randomUUID(), ruleId, trigger, status: "running", txHashes: [] as string[] };
    this.runs.push(run);
    return run;
  }
  async finishRun(id: string, r: { status: string; amountOut?: bigint | null; txHashes: string[]; error?: string | null }) {
    Object.assign(this.runs.find((x) => x.id === id)!, r);
  }
  async setNextRun() {}
  async setCursor() {}
  async stopRule(id: string) {
    this.rules.get(id)!.status = "stopped";
  }
}

describe("peso guardian through the deployed guard", { timeout: 600_000 }, () => {
  let client: PublicClient;
  let rpcUrl: string;
  const wallets = new Map<Address, WalletClient>();
  const store = new MemStore();
  const notes: string[] = [];
  let runner: RulesRunner;
  let signal: GuardianSignal;
  let clock = new Date("2026-11-04T15:00:00Z");
  let ruleId: string;

  const bal = (token: Address, who: Address) => client.readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [who] });
  const userSends = (to: Address, data: Hex, purpose: string) => sendGuarded({ mode: "fork", publicClient: client, walletClient: wallets.get(USER.address)!, to, data, usdMicros: 0n, purpose, ledger: new MemoryLedger() });

  beforeAll(async () => {
    rpcUrl = inject("forkRpcUrl");
    client = makePublicClient({ rpcUrl, pollingInterval: 100 });
    expect(await isAnvil(client)).toBe(true);
    // anvil fetches mainnet state from forno on first touch: allow slow answers.
    const test = createTestClient({ mode: "anvil", chain: celoMainnet, transport: http(rpcUrl, { timeout: 120_000 }) });
    for (const a of [USER, OPERATOR]) {
      await test.setBalance({ address: a.address, value: parseEther("2") });
      wallets.set(a.address, makeWalletClient(a, { rpcUrl, pollingInterval: 100 }));
    }
    // 30 USDT from outside (the wARS pool, impersonated): the account holds dollars only.
    await test.setBalance({ address: WARS_POOL, value: parseEther("1") });
    await test.impersonateAccount({ address: WARS_POOL });
    const pool = createWalletClient({ account: WARS_POOL, chain: celoMainnet, transport: http(rpcUrl, { timeout: 120_000 }) });
    await client.waitForTransactionReceipt({ hash: await pool.writeContract({ address: USDT, abi: erc20, functionName: "transfer", args: [USER.address, 30_000_000n] }) });
    await test.stopImpersonatingAccount({ address: WARS_POOL });

    await userSends(USDT, encodeFunctionData({ abi: erc20, functionName: "approve", args: [GUARD, 100_000_000n] }), "approve USDT");
    await userSends(WARS, encodeFunctionData({ abi: erc20, functionName: "approve", args: [GUARD, 200_000n * 10n ** 18n] }), "approve wARS");
    await userSends(
      GUARD,
      encodeGuardV2Configure({
        account: USER.address,
        paused: false,
        maxSlippageBps: 100,
        limits: [
          { token: USDT, maxPerTx: 10_000_000n, maxPerDay: 50_000_000n },
          { token: WARS, maxPerTx: 25_000n * 10n ** 18n, maxPerDay: 80_000n * 10n ** 18n },
        ],
        recipients: [],
        prices: [],
      }),
      "configure",
    );
    await userSends(GUARD, encodeGuardV2SetOperator(OPERATOR.address, (await client.getBlock()).timestamp + 30n * 86_400n), "setOperator");

    // The peso gaining ~3.5% a month, priced near the pool (~1,650 per dollar).
    signal = { fiatPerUsd: 1650, carryBpsPerDay: -11.52, carrySource: "measured", holding: false };
    runner = new RulesRunner({
      store,
      publicClient: client,
      operator: OPERATOR,
      walletClient: wallets.get(OPERATOR.address)!,
      guard: GUARD,
      mode: "fork",
      ledger: new MemoryLedger(),
      notify: async (_a, text) => void notes.push(text),
      now: () => clock,
      guardianSignal: async () => signal,
      guardianEveryMs: 0,
      slippageBps: 100,
    });
    ruleId = randomUUID();
    store.rules.set(ruleId, { id: ruleId, account: USER.address.toLowerCase(), kind: "guardian", params: { sym: "wARS", baseDollarPct: 50, bandPct: 5 }, lang: "en", nextRunAt: null, cursorBlock: null, status: "active" });
  }, 900_000); // the setup sends four transactions against a fork that reads mainnet state over the network

  it("while the peso gains, moves dollars into pesos down to the target, in pieces, once a day", async () => {
    // Target 30% in dollars (50 − 20); the account holds 100%: move 21 USDT, at most 10 per transaction.
    await runner.tick();
    const run = store.runs.find((r) => r.ruleId === ruleId)!;
    expect(run).toMatchObject({ status: "done", trigger: "guardian:reenter:2026-11-04" });
    expect(run.txHashes).toHaveLength(3); // 10 + 10 + 1
    expect(await bal(USDT, USER.address)).toBe(9_000_000n);
    expect(await bal(WARS, USER.address)).toBe(run.amountOut);
    expect(notes.at(-1)).toMatch(/moved dollars back to wARS: wARS is gaining 3\.5% a month/);

    await runner.tick(); // same day, same direction: nothing more
    expect(store.runs.filter((r) => r.ruleId === ruleId)).toHaveLength(1);
  });

  it("holds while the desk's sources disagree", async () => {
    signal = { ...signal, carryBpsPerDay: 10, holding: true };
    const usdt0 = await bal(USDT, USER.address);
    await runner.tick();
    expect(store.runs.filter((r) => r.ruleId === ruleId)).toHaveLength(1);
    expect(await bal(USDT, USER.address)).toBe(usdt0);
  });

  it("when the peso starts losing value, moves pesos to dollars", async () => {
    // Target 70% (50 + 20); the account holds ~30%: sell ~12 USD of pesos.
    signal = { ...signal, holding: false };
    clock = new Date("2026-11-05T15:00:00Z");
    const usdt0 = await bal(USDT, USER.address);
    await runner.tick();
    const run = store.runs.find((r) => r.ruleId === ruleId && r.trigger === "guardian:protect:2026-11-05")!;
    expect(run.status).toBe("done");
    const gained = (await bal(USDT, USER.address)) - usdt0;
    expect(gained).toBe(run.amountOut);
    expect(gained).toBeGreaterThan(10_000_000n);
    expect(notes.at(-1)).toMatch(/moved wARS to dollars: wARS is losing 3\.0% a month/);
  });
});
