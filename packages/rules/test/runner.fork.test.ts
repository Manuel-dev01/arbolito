/**
 * The rules runner against the deployed ArbolitoGuard v2 on a Celo fork.
 *
 * A fresh MiniPay-style account sets the guard up (bounded approvals, caps, one contact, Arbolito's
 * operator), then the runner executes its rules with the operator key: a monthly send converted
 * to pesos, and a payday split triggered by a payment from someone else. A month never runs
 * twice, the account's own transfers aren't pay, caps are respected, and a revoked permission
 * stops the rule.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, inject, it } from "vitest";
import { createTestClient, createWalletClient, encodeFunctionData, http, parseAbi, parseEther, type Address, type Hex, type PublicClient, type WalletClient } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { POOLS, TOKENS } from "@arbolito/config";
import { MemoryLedger, celoMainnet, encodeGuardV2Configure, encodeGuardV2RevokeOperator, encodeGuardV2SetOperator, isAnvil, makePublicClient, makeWalletClient, sendGuarded } from "@arbolito/chain";
import { RulesRunner, type RunnerStore, type StoredRule } from "../src/runner";

const GUARD = "0x411E44dB70476F74C3560F5cCFdbc8c63f231d33" as Address; // mainnet deployment (docs/04-reference.md)
const USDT = TOKENS.USDT.address as Address;
const WARS = TOKENS.wARS.address as Address;
const WARS_POOL = POOLS.find((p) => p.name.startsWith("wARS/USDT"))!.address as Address;
const USER = privateKeyToAccount(generatePrivateKey());
const OPERATOR = privateKeyToAccount(generatePrivateKey());
const CONTACT = privateKeyToAccount(generatePrivateKey()).address;
const erc20 = parseAbi(["function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)", "function transfer(address,uint256) returns (bool)"]);

/** In-memory RunnerStore with the database's semantics (unique (rule, trigger)). */
class MemStore implements RunnerStore {
  rules = new Map<string, StoredRule & { status: string; stoppedReason?: string }>();
  runs: { id: string; ruleId: string; trigger: string; status: string; amountOut?: bigint | null; txHashes: string[]; error?: string | null }[] = [];
  add(r: Omit<StoredRule, "id" | "lang">) {
    const id = randomUUID();
    this.rules.set(id, { ...r, id, lang: "es", status: "active" });
    return id;
  }
  async dueSendRules(now: Date) {
    return [...this.rules.values()].filter((r) => r.status === "active" && r.kind === "send" && r.nextRunAt && r.nextRunAt <= now);
  }
  async activeSplitRules() {
    return [...this.rules.values()].filter((r) => r.status === "active" && r.kind === "split");
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
  async setNextRun(id: string, at: Date) {
    this.rules.get(id)!.nextRunAt = at;
  }
  async setCursor(id: string, block: bigint) {
    this.rules.get(id)!.cursorBlock = block;
  }
  async stopRule(id: string, reason: string) {
    Object.assign(this.rules.get(id)!, { status: "stopped", stoppedReason: reason, nextRunAt: null });
  }
}

describe("rules runner through the deployed guard", () => {
  let client: PublicClient;
  let rpcUrl: string;
  let test: ReturnType<typeof createTestClient>;
  const wallets = new Map<Address, WalletClient>();
  const ledger = new MemoryLedger();
  const store = new MemStore();
  const notes: string[] = [];
  let runner: RulesRunner;
  let clock = new Date("2026-11-01T13:00:05Z");

  const bal = (token: Address, who: Address) => client.readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [who] });
  const userSends = (to: Address, data: Hex, purpose: string) => sendGuarded({ mode: "fork", publicClient: client, walletClient: wallets.get(USER.address)!, to, data, usdMicros: 0n, purpose, ledger });
  /** A payment into the account from someone else (the wARS pool, impersonated). */
  async function payFromOutside(amount: bigint) {
    await test.impersonateAccount({ address: WARS_POOL });
    const pool = createWalletClient({ account: WARS_POOL, chain: celoMainnet, transport: http(rpcUrl) });
    await client.waitForTransactionReceipt({ hash: await pool.writeContract({ address: USDT, abi: erc20, functionName: "transfer", args: [USER.address, amount] }) });
    await test.stopImpersonatingAccount({ address: WARS_POOL });
  }

  beforeAll(async () => {
    rpcUrl = inject("forkRpcUrl");
    client = makePublicClient({ rpcUrl, pollingInterval: 100 });
    expect(await isAnvil(client)).toBe(true);
    test = createTestClient({ mode: "anvil", chain: celoMainnet, transport: http(rpcUrl) });
    await test.setBalance({ address: WARS_POOL, value: parseEther("1") });
    for (const a of [USER, OPERATOR] as PrivateKeyAccount[]) {
      await test.setBalance({ address: a.address, value: parseEther("2") });
      wallets.set(a.address, makeWalletClient(a, { rpcUrl, pollingInterval: 100 }));
    }
    await payFromOutside(30_000_000n);

    // The account's own setup (what the Mini App's "Turn on" sends from MiniPay).
    await userSends(USDT, encodeFunctionData({ abi: erc20, functionName: "approve", args: [GUARD, 20_000_000n] }), "approve USDT");
    await userSends(WARS, encodeFunctionData({ abi: erc20, functionName: "approve", args: [GUARD, 100_000n * 10n ** 18n] }), "approve wARS");
    await userSends(
      GUARD,
      encodeGuardV2Configure({
        account: USER.address,
        paused: false,
        maxSlippageBps: 100,
        limits: [
          { token: USDT, maxPerTx: 4_000_000n, maxPerDay: 12_000_000n },
          { token: WARS, maxPerTx: 10_000n * 10n ** 18n, maxPerDay: 30_000n * 10n ** 18n },
        ],
        recipients: [{ recipient: CONTACT, allowed: true }],
        prices: [],
      }),
      "configure",
    );
    const now = (await client.getBlock()).timestamp;
    await userSends(GUARD, encodeGuardV2SetOperator(OPERATOR.address, now + 30n * 86_400n), "setOperator");

    runner = new RulesRunner({
      store,
      publicClient: client,
      operator: OPERATOR,
      walletClient: wallets.get(OPERATOR.address)!,
      guard: GUARD,
      mode: "fork",
      ledger,
      notify: async (_a, text) => void notes.push(text),
      now: () => clock,
      confirmations: 0n,
    });
  });

  it("a monthly send converts 3 USDT to pesos and pays the contact, once", async () => {
    const id = store.add({ account: USER.address.toLowerCase(), kind: "send", params: { contact: CONTACT, contactName: "Mamá", amountUsdt: "3000000", receive: "wARS", dayOfMonth: 1 }, nextRunAt: new Date("2026-11-01T13:00:00Z"), cursorBlock: null });
    const usdt0 = await bal(USDT, USER.address);
    await runner.tick();
    const run = store.runs.find((r) => r.ruleId === id)!;
    expect(run).toMatchObject({ status: "done", trigger: "send:2026-11" });
    expect(run.txHashes).toHaveLength(2); // swapFor, then sendFor
    expect(await bal(USDT, USER.address)).toBe(usdt0 - 3_000_000n);
    expect(await bal(WARS, CONTACT)).toBe(run.amountOut);
    expect(run.amountOut!).toBeGreaterThan(3n * 1_000n * 10n ** 18n); // ~3 × 1,600 pesos
    expect(store.rules.get(id)!.nextRunAt!.toISOString()).toBe("2026-12-01T13:00:00.000Z");
    expect(notes.at(-1)).toContain("Arbolito hizo tu regla");

    // Even forced due again for the same month, it doesn't repeat.
    store.rules.get(id)!.nextRunAt = new Date("2026-11-01T13:00:00Z");
    await runner.tick();
    expect(store.runs.filter((r) => r.ruleId === id)).toHaveLength(1);
    expect(await bal(WARS, CONTACT)).toBe(run.amountOut);
  });

  it("a payday split changes 30% of a payment from someone else, and ignores the account's own transfers", async () => {
    const id = store.add({ account: USER.address.toLowerCase(), kind: "split", params: { percent: 30, to: "wARS", minIncomingUsdt: "2000000" }, nextRunAt: null, cursorBlock: null });
    await runner.tick(); // sets the cursor: only payments from now on
    await payFromOutside(5_000_000n); // pay
    await payFromOutside(1_000_000n); // under the minimum
    await userSends(USDT, encodeFunctionData({ abi: erc20, functionName: "transfer", args: [USER.address, 3_000_000n] }), "self transfer"); // not pay
    const wars0 = await bal(WARS, USER.address);
    await runner.tick();
    const runs = store.runs.filter((r) => r.ruleId === id);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: "done" });
    expect((await bal(WARS, USER.address)) - wars0).toBe(runs[0]!.amountOut); // 1.5 USDT worth, paid to the account
    await runner.tick();
    expect(store.runs.filter((r) => r.ruleId === id)).toHaveLength(1); // the cursor moved on
  });

  it("skips a run over the account's per-transaction cap, and stops when the permission is revoked", async () => {
    const big = store.add({ account: USER.address.toLowerCase(), kind: "send", params: { contact: CONTACT, contactName: "Mamá", amountUsdt: "6000000", receive: "USDT", dayOfMonth: 1 }, nextRunAt: new Date("2026-11-01T13:00:00Z"), cursorBlock: null });
    await runner.tick();
    expect(store.runs.find((r) => r.ruleId === big)).toMatchObject({ status: "skipped", txHashes: [] });
    expect(store.rules.get(big)!.status).toBe("active"); // next month may fit

    await userSends(GUARD, encodeGuardV2RevokeOperator(), "revokeOperator");
    clock = new Date("2026-12-01T13:00:05Z");
    const usdt0 = await bal(USDT, USER.address);
    await runner.tick();
    const stopped = [...store.rules.values()].filter((r) => r.status === "stopped");
    expect(stopped.length).toBeGreaterThan(0);
    expect(stopped[0]!.stoppedReason).toContain("permission");
    expect(await bal(USDT, USER.address)).toBe(usdt0); // nothing moved
  });
});
