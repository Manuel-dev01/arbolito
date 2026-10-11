/**
 * ArbolitoGuard (v2) with a MiniPay-style user EOA, on a Celo fork.
 *
 * The user's own wallet (a fresh random key) approves the guard with bounded allowances,
 * configures caps and one contact, and names Arbolito's operator EOA. The operator then swaps
 * (paid to the user, at the TWAP floor) and pays the contact. It can't pay a stranger, raise
 * caps, swap at minOut = 0, or act after the user revokes it.
 *
 * Every tx goes through sendGuarded mode "fork", so every one carries the ERC-8021 suffix.
 * On mainnet the user's txs are sent by MiniPay (gas in stablecoins). anvil can't simulate
 * Celo fee-currency txs, so here the user pays gas in CELO.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, inject, it } from "vitest";
import {
  createTestClient,
  createWalletClient,
  decodeErrorResult,
  encodeDeployData,
  encodeFunctionData,
  getAddress,
  http,
  parseAbi,
  parseEther,
  parseEventLogs,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { POOLS, TOKENS, CONTRACTS, findRepoRoot, loadEnv } from "@arbolito/config";
import {
  FORK_ATTRIBUTION_CODE,
  MemoryLedger,
  arbolitoGuardAbi,
  attributionCodes,
  celoMainnet,
  encodeGuardV2Configure,
  encodeGuardV2RevokeOperator,
  encodeGuardV2SendFor,
  encodeGuardV2SetOperator,
  encodeGuardV2SwapFor,
  encodeV3Path,
  guardV2ConstructorArgs,
  isAnvil,
  makePublicClient,
  makeWalletClient,
  readGuardV2Budget,
  readGuardV2IsContact,
  readGuardV2MinOutFloor,
  readGuardV2Operator,
  readGuardV2Settings,
  sendGuarded,
  type GuardV2Config,
} from "../src";

const USDT = TOKENS.USDT.address;
const WARS = TOKENS.wARS.address;
const ROUTER = CONTRACTS.uniswap.swapRouter02;
const WARS_POOL = POOLS.find((p) => p.name.startsWith("wARS/USDT"))!.address;
// Fresh keys only: anvil's dev addresses carry EIP-7702 sweepers on Celo mainnet (and the fork).
const DEPLOYER = privateKeyToAccount(generatePrivateKey());
const USER = privateKeyToAccount(generatePrivateKey()); // the MiniPay EOA
const OPERATOR = privateKeyToAccount(generatePrivateKey()); // Arbolito's operator EOA
const CONTACT = privateKeyToAccount(generatePrivateKey()).address;
const STRANGER = privateKeyToAccount(generatePrivateKey()).address;

const erc20Abi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);

// Kept inside the build caps sendGuarded enforces ($5 per action, $25 per day).
const LIMITS = { usdtPerTx: 4_000_000n, usdtPerDay: 8_000_000n };
const ALLOWANCE = 10_000_000n; // the hard ceiling the user gives the guard
const SLIPPAGE_BPS = 50;

function guardBytecode(): Hex {
  const path = join(findRepoRoot(), "contracts", "out", "ArbolitoGuard.sol", "ArbolitoGuard.json");
  return (JSON.parse(readFileSync(path, "utf8")) as { bytecode: { object: Hex } }).bytecode.object;
}

/** Walks a viem error chain for revert data and decodes it with the guard's ABI. */
function revertName(err: unknown): string {
  for (let e = err as { cause?: unknown; data?: unknown } | undefined; e; e = e.cause as typeof e) {
    const data = typeof e.data === "string" ? e.data : (e.data as { data?: unknown } | undefined)?.data;
    if (typeof data === "string" && data.startsWith("0x") && data.length >= 10) {
      try {
        const r = decodeErrorResult({ abi: arbolitoGuardAbi, data: data as Hex });
        return `${r.errorName}(${(r.args ?? []).map(String).join(", ")})`;
      } catch {
        /* keep walking */
      }
    }
  }
  return `undecoded: ${(err as Error).message.split("\n")[0]}`;
}

describe("ArbolitoGuard v2: MiniPay EOA + operator", () => {
  let publicClient: PublicClient;
  let rpcUrl: string;
  let guard: Address;
  const wallets = new Map<Address, WalletClient>();
  const ledger = new MemoryLedger();
  const gasReport: string[] = [];

  const balance = (token: Address, who: Address) =>
    publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [who] });
  const now = async () => (await publicClient.getBlock()).timestamp;

  /** sendGuarded in fork mode (attribution suffix, caps, simulation). Checks the suffix landed. */
  async function send(from: PrivateKeyAccount, to: Address | undefined, data: Hex, purpose: string, usdMicros = 0n) {
    const res = await sendGuarded({ mode: "fork", publicClient, walletClient: wallets.get(from.address)!, to, data, usdMicros, purpose, ledger });
    expect(res.receipt.status).toBe("success");
    const tx = await publicClient.getTransaction({ hash: res.hash });
    // Fork sends carry the real code when one is configured, else the placeholder.
    expect(attributionCodes(tx.input)).toContain(loadEnv().ATTRIBUTION_CODE ?? FORK_ATTRIBUTION_CODE);
    gasReport.push(`${purpose}: gasUsed ${res.receipt.gasUsed}`);
    return res;
  }

  /** What the guard says to `data` sent from `from` (eth_call). */
  async function guardSays(from: Address, data: Hex): Promise<string> {
    try {
      await publicClient.call({ account: from, to: guard, data });
      return "ok";
    } catch (err) {
      return revertName(err);
    }
  }

  /** The operator tries a call through sendGuarded: it must refuse (simulation reverts), and nothing is broadcast. */
  async function operatorRefused(data: Hex, purpose: string, usdMicros = 0n) {
    const nonce = await publicClient.getTransactionCount({ address: OPERATOR.address });
    await expect(
      sendGuarded({ mode: "fork", publicClient, walletClient: wallets.get(OPERATOR.address)!, to: guard, data, usdMicros, purpose, ledger }),
    ).rejects.toThrow();
    expect(await publicClient.getTransactionCount({ address: OPERATOR.address })).toBe(nonce);
  }

  async function config(partial: Partial<GuardV2Config>): Promise<GuardV2Config> {
    return { account: USER.address, paused: false, maxSlippageBps: SLIPPAGE_BPS, limits: [], recipients: [], prices: [], ...partial };
  }

  beforeAll(async () => {
    rpcUrl = inject("forkRpcUrl");
    publicClient = makePublicClient({ rpcUrl, pollingInterval: 100 });
    expect(await isAnvil(publicClient)).toBe(true);
    const testClient = createTestClient({ mode: "anvil", chain: celoMainnet, transport: http(rpcUrl) });
    for (const a of [DEPLOYER, USER, OPERATOR]) {
      await testClient.setBalance({ address: a.address, value: parseEther("2") });
      wallets.set(a.address, makeWalletClient(a, { rpcUrl, pollingInterval: 100 }));
    }

    const deployData = encodeDeployData({ abi: arbolitoGuardAbi, bytecode: guardBytecode(), args: guardV2ConstructorArgs() });
    const deployed = await send(DEPLOYER, undefined, deployData, "deploy ArbolitoGuard");
    guard = getAddress(deployed.receipt.contractAddress!);

    // 30 USDT to the user, borrowed from the wARS pool.
    await testClient.setBalance({ address: WARS_POOL, value: parseEther("1") });
    await testClient.impersonateAccount({ address: WARS_POOL });
    const pool = createWalletClient({ account: WARS_POOL, chain: celoMainnet, transport: http(rpcUrl), pollingInterval: 100 });
    const h = await pool.writeContract({ address: USDT, abi: erc20Abi, functionName: "transfer", args: [USER.address, 30_000_000n] });
    await publicClient.waitForTransactionReceipt({ hash: h });
    await testClient.stopImpersonatingAccount({ address: WARS_POOL });
  });

  it("onboards from the user's own EOA: bounded approve, configure (caps + one contact), set operator", async () => {
    expect((await readGuardV2Settings(publicClient, guard, USER.address)).configured).toBe(false);
    const approve = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [guard, ALLOWANCE] });
    await send(USER, USDT, approve, "user: approve USDT to guard (bounded)");
    const cfg = await config({
      limits: [{ token: USDT, maxPerTx: LIMITS.usdtPerTx, maxPerDay: LIMITS.usdtPerDay }],
      recipients: [{ recipient: CONTACT, allowed: true }],
    });
    await send(USER, guard, encodeGuardV2Configure(cfg), "user: configure");
    const expiry = (await now()) + 86_400n;
    await send(USER, guard, encodeGuardV2SetOperator(OPERATOR.address, expiry), "user: setOperator");

    expect(await readGuardV2Settings(publicClient, guard, USER.address)).toEqual({ configured: true, paused: false, maxSlippageBps: SLIPPAGE_BPS });
    expect(await readGuardV2Operator(publicClient, guard, USER.address)).toEqual({ operator: OPERATOR.address, expiry, active: true });
    expect(await readGuardV2IsContact(publicClient, guard, USER.address, CONTACT)).toBe(true);
    expect(await readGuardV2Budget(publicClient, guard, USER.address, USDT)).toEqual({
      maxPerTx: LIMITS.usdtPerTx,
      maxPerDay: LIMITS.usdtPerDay,
      spentToday: 0n,
      available: LIMITS.usdtPerTx,
    });
  });

  it("the operator swaps 3 USDT -> wARS at the TWAP floor, paid to the user", async () => {
    const path = encodeV3Path([USDT, WARS], [100]);
    const amountIn = 3_000_000n;
    const floor = await readGuardV2MinOutFloor(publicClient, guard, USER.address, path, amountIn);
    const [usdt0, wars0] = await Promise.all([balance(USDT, USER.address), balance(WARS, USER.address)]);
    const { receipt } = await send(OPERATOR, guard, encodeGuardV2SwapFor(USER.address, path, amountIn, floor), "operator: swapFor", amountIn);
    expect(await balance(USDT, USER.address)).toBe(usdt0 - amountIn);
    expect((await balance(WARS, USER.address)) - wars0).toBeGreaterThanOrEqual(floor);
    expect(await balance(WARS, OPERATOR.address)).toBe(0n);
    expect(await balance(USDT, guard)).toBe(0n);
    expect(await publicClient.readContract({ address: USDT, abi: erc20Abi, functionName: "allowance", args: [guard, ROUTER] })).toBe(0n);
    const swapped = parseEventLogs({ abi: arbolitoGuardAbi, logs: receipt.logs, eventName: "Swapped" });
    expect(swapped).toHaveLength(1);
    expect(swapped[0]!.args).toMatchObject({ account: USER.address, by: OPERATOR.address, tokenIn: USDT, tokenOut: WARS, floor });
  });

  it("the operator pays the saved contact", async () => {
    const { receipt } = await send(OPERATOR, guard, encodeGuardV2SendFor(USER.address, USDT, CONTACT, 1_000_000n), "operator: sendFor contact", 1_000_000n);
    expect(await balance(USDT, CONTACT)).toBe(1_000_000n);
    const sent = parseEventLogs({ abi: arbolitoGuardAbi, logs: receipt.logs, eventName: "Sent" });
    expect(sent[0]!.args).toMatchObject({ account: USER.address, to: CONTACT, by: OPERATOR.address, amount: 1_000_000n });
    expect((await readGuardV2Budget(publicClient, guard, USER.address, USDT)).spentToday).toBe(4_000_000n);
  });

  it("the operator can't send to a stranger", async () => {
    const data = encodeGuardV2SendFor(USER.address, USDT, STRANGER, 1_000_000n);
    expect(await guardSays(OPERATOR.address, data)).toBe(`NotRecipient(${STRANGER})`);
    await operatorRefused(data, "operator: sendFor stranger (refused)", 1_000_000n);
    expect(await balance(USDT, STRANGER)).toBe(0n);
  });

  it("the operator can't raise caps or add contacts (configure is account-only)", async () => {
    const raise = await config({
      limits: [{ token: USDT, maxPerTx: 10n ** 30n, maxPerDay: 10n ** 30n }],
      recipients: [{ recipient: STRANGER, allowed: true }],
    });
    const data = encodeGuardV2Configure(raise);
    expect(await guardSays(OPERATOR.address, data)).toBe(`NotAccount(${OPERATOR.address}, ${USER.address})`);
    await operatorRefused(data, "operator: configure (refused)");
    expect(await readGuardV2Budget(publicClient, guard, USER.address, USDT)).toMatchObject({ maxPerTx: LIMITS.usdtPerTx, maxPerDay: LIMITS.usdtPerDay });
    expect(await readGuardV2IsContact(publicClient, guard, USER.address, STRANGER)).toBe(false);
    // The caps themselves hold: over per-tx, and over the day (4 spent, 4 more is the limit).
    expect(await guardSays(OPERATOR.address, encodeGuardV2SendFor(USER.address, USDT, CONTACT, LIMITS.usdtPerTx + 1n))).toBe(
      `ExceedsTxCap(${USDT}, ${LIMITS.usdtPerTx + 1n}, ${LIMITS.usdtPerTx})`,
    );
    await send(OPERATOR, guard, encodeGuardV2SendFor(USER.address, USDT, CONTACT, 4_000_000n), "operator: sendFor up to the day cap", 4_000_000n);
    expect(await guardSays(OPERATOR.address, encodeGuardV2SendFor(USER.address, USDT, CONTACT, 1n))).toBe(
      `ExceedsDayCap(${USDT}, ${LIMITS.usdtPerDay}, ${LIMITS.usdtPerDay})`,
    );
  });

  it("the operator can't swap at minOut = 0 or just below the floor", async () => {
    // The day cap is used up, so the user lifts it (from their own wallet) to isolate the floor check.
    await send(USER, guard, encodeGuardV2Configure(await config({ limits: [{ token: USDT, maxPerTx: LIMITS.usdtPerTx, maxPerDay: 12_000_000n }] })), "user: raise day cap");
    const path = encodeV3Path([USDT, WARS], [100]);
    const floor = await readGuardV2MinOutFloor(publicClient, guard, USER.address, path, 1_000_000n);
    expect(await guardSays(OPERATOR.address, encodeGuardV2SwapFor(USER.address, path, 1_000_000n, 0n))).toBe(`MinOutBelowFloor(0, ${floor})`);
    expect(await guardSays(OPERATOR.address, encodeGuardV2SwapFor(USER.address, path, 1_000_000n, floor - 1n))).toBe(
      `MinOutBelowFloor(${floor - 1n}, ${floor})`,
    );
    await operatorRefused(encodeGuardV2SwapFor(USER.address, path, 1_000_000n, 0n), "operator: swapFor minOut=0 (refused)", 1_000_000n);
    expect(await guardSays(OPERATOR.address, encodeGuardV2SwapFor(USER.address, path, 1_000_000n, floor))).toBe("ok");
  });

  it("after the user revokes, the operator can't act at all", async () => {
    await send(USER, guard, encodeGuardV2RevokeOperator(), "user: revokeOperator");
    expect((await readGuardV2Operator(publicClient, guard, USER.address)).active).toBe(false);
    const path = encodeV3Path([USDT, WARS], [100]);
    const floor = await readGuardV2MinOutFloor(publicClient, guard, USER.address, path, 1_000_000n);
    const send1 = encodeGuardV2SendFor(USER.address, USDT, CONTACT, 1_000_000n);
    expect(await guardSays(OPERATOR.address, send1)).toBe(`NotOperator(${OPERATOR.address}, ${USER.address})`);
    expect(await guardSays(OPERATOR.address, encodeGuardV2SwapFor(USER.address, path, 1_000_000n, floor))).toBe(
      `NotOperator(${OPERATOR.address}, ${USER.address})`,
    );
    await operatorRefused(send1, "operator: sendFor after revoke (refused)", 1_000_000n);
    // The allowance is still the hard ceiling: 10 approved, 3 swapped + 5 sent = 8 used.
    expect(await publicClient.readContract({ address: USDT, abi: erc20Abi, functionName: "allowance", args: [USER.address, guard] })).toBe(2_000_000n);
    console.log(`[guard v2] ${guard}\n  ${gasReport.join("\n  ")}`);
  });
});
