/**
 * ArbolitoSessionExecutor as the session key's ONLY approved target, on a Celo fork.
 *
 * Extends the smart-account spike (smartAccount.fork.test.ts): the same self-bundled zero-fee
 * UserOps, but the session key is scoped to the guard instead of SwapRouter02. The user's admin
 * signs one onboarding op (deploy + bounded approvals to the guard + session-key grant + guard
 * config). The key can then swap (paid to the account, above the TWAP floor) and pay saved
 * contacts, and cannot pay a stranger, raise its own caps, swap at minOut = 0, or reach the
 * router or tokens directly. Runs for EntryPoint v0.6 and v0.7.
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
  formatEther,
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
import { entryPoint06Abi, entryPoint07Abi } from "viem/account-abstraction";
import { CONTRACTS, POOLS, TOKENS, findRepoRoot } from "@arbolito/config";
import {
  FORK_ATTRIBUTION_CODE,
  THIRDWEB_ACCOUNT_V06,
  THIRDWEB_ACCOUNT_V07,
  accountInitCode,
  buildZeroFeeUserOp,
  celoMainnet,
  encodeAccountCalls,
  encodeApplyConfig,
  encodeGuardPause,
  encodeGuardSend,
  encodeGuardSwap,
  encodeHandleOps,
  encodeSetPermissionsForSigner,
  encodeV3Path,
  getAccountNonce,
  guardConstructorArgs,
  isAnvil,
  makePublicClient,
  makeWalletClient,
  predictAccountAddress,
  readGuardNonce,
  readMinOutFloor,
  sessionExecutorAbi,
  sessionKeyRequest,
  signConfigUpdate,
  signPermissionRequest,
  signUserOp,
  thirdwebAccountAbi,
  type Call,
  type ConfigUpdate,
  type ThirdwebAccountKind,
  type UserOp,
} from "../src";

const CHAIN_ID = 42220;
const CODE = FORK_ATTRIBUTION_CODE;
const ROUTER = CONTRACTS.uniswap.swapRouter02;
const USDT = TOKENS.USDT.address;
const WARS = TOKENS.wARS.address;
const WARS_POOL = POOLS.find((p) => p.name.startsWith("wARS/USDT"))!.address;
// Fresh keys only: anvil's dev addresses carry EIP-7702 sweepers on Celo mainnet (and the fork).
const RELAYER = privateKeyToAccount(generatePrivateKey());

const erc20Abi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);
const routerAbi = parseAbi([
  "struct ExactInputSingleParams { address tokenIn; address tokenOut; uint24 fee; address recipient; uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96; }",
  "function exactInputSingle(ExactInputSingleParams params) payable returns (uint256 amountOut)",
]);

function guardBytecode(): Hex {
  const path = join(findRepoRoot(), "contracts", "out", "ArbolitoSessionExecutor.sol", "ArbolitoSessionExecutor.json");
  return (JSON.parse(readFileSync(path, "utf8")) as { bytecode: { object: Hex } }).bytecode.object;
}

/** Walks a viem error chain for revert data and decodes it with `abi`. */
function revertName(err: unknown, abi: Parameters<typeof decodeErrorResult>[0]["abi"]): string {
  for (let e = err as { cause?: unknown; data?: unknown } | undefined; e; e = e.cause as typeof e) {
    const data = typeof e.data === "string" ? e.data : (e.data as { data?: unknown } | undefined)?.data;
    if (typeof data === "string" && data.startsWith("0x") && data.length >= 10) {
      try {
        const r = decodeErrorResult({ abi, data: data as Hex });
        return `${r.errorName}(${(r.args ?? []).map(String).join(", ")})`;
      } catch {
        /* keep walking */
      }
    }
  }
  return `undecoded: ${(err as Error).message.split("\n")[0]}`;
}

describe.each([THIRDWEB_ACCOUNT_V06, THIRDWEB_ACCOUNT_V07])("session key scoped to the guard, EntryPoint v$version", (kind) => {
  let publicClient: PublicClient;
  let relayerWallet: WalletClient;
  let guard: Address;
  const user = privateKeyToAccount(generatePrivateKey()); // the account's admin
  const arbolito = privateKeyToAccount(generatePrivateKey()); // the session key
  const contact = privateKeyToAccount(generatePrivateKey()).address;
  const stranger = privateKeyToAccount(generatePrivateKey()).address;
  let account: Address;
  const gasReport: string[] = [];
  const LIMITS = { usdtPerTx: 20_000_000n, usdtPerDay: 30_000_000n, warsPerTx: 50_000n * 10n ** 18n, warsPerDay: 100_000n * 10n ** 18n };
  const SLIPPAGE_BPS = 50;

  const balance = (token: Address, who: Address) =>
    publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [who] });
  const now = async () => (await publicClient.getBlock()).timestamp;

  async function sessionOp(signer: PrivateKeyAccount, calls: readonly Call[]): Promise<UserOp> {
    const nonce = await getAccountNonce(publicClient, kind, account);
    const op = buildZeroFeeUserOp({ sender: account, nonce, callData: encodeAccountCalls(calls), attributionCode: CODE });
    return signUserOp(signer, kind, CHAIN_ID, op);
  }

  /** eth_call of handleOps: "ok" or the EntryPoint's FailedOp (validation errors, e.g. AA24). */
  async function simulate(op: UserOp): Promise<string> {
    try {
      await publicClient.call({ account: RELAYER.address, to: kind.entryPoint, data: encodeHandleOps(kind, [op], RELAYER.address) });
      return "ok";
    } catch (err) {
      return revertName(err, kind.version === "0.6" ? entryPoint06Abi : entryPoint07Abi);
    }
  }

  /** What the guard says to a call made as the account (the inner revert reason of a UserOp). */
  async function guardSays(data: Hex): Promise<string> {
    try {
      await publicClient.call({ account, to: guard, data });
      return "ok";
    } catch (err) {
      return revertName(err, sessionExecutorAbi);
    }
  }

  async function relay(ops: UserOp[], label: string) {
    const data = encodeHandleOps(kind, ops, RELAYER.address, CODE);
    const gas = await publicClient.estimateGas({ account: RELAYER.address, to: kind.entryPoint, data });
    const hash = await relayerWallet.sendTransaction({ account: RELAYER, chain: celoMainnet, to: kind.entryPoint, data, gas: (gas * 12n) / 10n });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    expect(receipt.status).toBe("success");
    const events = parseEventLogs({ abi: entryPoint06Abi, logs: receipt.logs, eventName: "UserOperationEvent" });
    gasReport.push(`${label}: handleOps gasUsed ${receipt.gasUsed}, op actualGasUsed ${events[0]?.args.actualGasUsed}`);
    return { receipt, events };
  }

  async function config(partial: Partial<ConfigUpdate>): Promise<ConfigUpdate> {
    return {
      account,
      nonce: await readGuardNonce(publicClient, guard, account),
      deadline: (await now()) + 3600n,
      paused: false,
      maxSlippageBps: SLIPPAGE_BPS,
      limits: [],
      recipients: [],
      prices: [],
      ...partial,
    };
  }

  beforeAll(async () => {
    const rpcUrl = inject("forkRpcUrl");
    publicClient = makePublicClient({ rpcUrl, pollingInterval: 100 });
    expect(await isAnvil(publicClient)).toBe(true);
    relayerWallet = makeWalletClient(RELAYER, { rpcUrl, pollingInterval: 100 });
    const testClient = createTestClient({ mode: "anvil", chain: celoMainnet, transport: http(rpcUrl) });
    await testClient.setBalance({ address: RELAYER.address, value: parseEther("10") });

    // One guard per suite, deployed by the relayer.
    const deploy = await relayerWallet.sendTransaction({
      account: RELAYER,
      chain: celoMainnet,
      data: encodeDeployData({ abi: sessionExecutorAbi, bytecode: guardBytecode(), args: guardConstructorArgs() }),
    });
    const deployed = await publicClient.waitForTransactionReceipt({ hash: deploy });
    guard = getAddress(deployed.contractAddress!); // receipts report it lowercased
    gasReport.push(`deploy guard: gasUsed ${deployed.gasUsed}`);

    account = await predictAccountAddress(publicClient, kind, user.address);
    // 100 USDT + 100k wARS to the counterfactual account, borrowed from the wARS pool.
    await testClient.setBalance({ address: WARS_POOL, value: parseEther("1") });
    await testClient.impersonateAccount({ address: WARS_POOL });
    const pool = createWalletClient({ account: WARS_POOL, chain: celoMainnet, transport: http(rpcUrl), pollingInterval: 100 });
    for (const [token, amount] of [[USDT, 100_000_000n], [WARS, 100_000n * 10n ** 18n]] as const) {
      const h = await pool.writeContract({ address: token, abi: erc20Abi, functionName: "transfer", args: [account, amount] });
      await publicClient.waitForTransactionReceipt({ hash: h });
    }
    await testClient.stopImpersonatingAccount({ address: WARS_POOL });
  });

  it("onboards in one admin-signed op: deploy + bounded approvals to the guard + key scoped to the guard + guard config", async () => {
    const t = await now();
    const grant = sessionKeyRequest({ signer: arbolito.address, approvedTargets: [guard], validFrom: t - 60n, validUntil: t + 86_400n });
    const grantSig = await signPermissionRequest(user, CHAIN_ID, account, grant);
    const cfg = await config({
      limits: [
        { token: USDT, maxPerTx: LIMITS.usdtPerTx, maxPerDay: LIMITS.usdtPerDay },
        { token: WARS, maxPerTx: LIMITS.warsPerTx, maxPerDay: LIMITS.warsPerDay },
      ],
      recipients: [{ recipient: contact, allowed: true }],
    });
    expect(cfg.nonce).toBe(0n);
    const cfgSig = await signConfigUpdate(user, CHAIN_ID, guard, cfg);
    const approve = (token: Address, amount: bigint) => ({
      to: token,
      data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [guard, amount] }),
    });
    const op = await signUserOp(
      user,
      kind,
      CHAIN_ID,
      buildZeroFeeUserOp({
        sender: account,
        nonce: 0n,
        initCode: accountInitCode(kind, user.address),
        callData: encodeAccountCalls([
          approve(USDT, 50_000_000n), // bounded: total exposure through the guard
          approve(WARS, 100_000n * 10n ** 18n),
          { to: account, data: encodeSetPermissionsForSigner(grant, grantSig) },
          { to: guard, data: encodeApplyConfig(cfg, cfgSig) },
        ]),
        callGasLimit: 900_000n,
      }),
    );
    const { events } = await relay([op], "onboarding (deploy + 2 approvals + grant + applyConfig)");
    expect(events[0]!.args.success).toBe(true);

    const perms = await publicClient.readContract({ address: account, abi: thirdwebAccountAbi, functionName: "getPermissionsForSigner", args: [arbolito.address] });
    expect(perms.approvedTargets).toEqual([guard]);
    expect(await readGuardNonce(publicClient, guard, account)).toBe(1n);
    expect(await publicClient.readContract({ address: guard, abi: sessionExecutorAbi, functionName: "isRecipient", args: [account, contact] })).toBe(true);
    expect(await publicClient.readContract({ address: guard, abi: sessionExecutorAbi, functionName: "limits", args: [account, USDT] })).toEqual([
      LIMITS.usdtPerTx,
      LIMITS.usdtPerDay,
    ]);
  });

  it("the session key swaps 10 USDT -> wARS through the guard, at the TWAP floor, paid to the account", async () => {
    const path = encodeV3Path([USDT, WARS], [100]);
    const amountIn = 10_000_000n;
    const floor = await readMinOutFloor(publicClient, guard, account, path, amountIn);
    const [usdt0, wars0] = await Promise.all([balance(USDT, account), balance(WARS, account)]);
    const { events, receipt } = await relay([await sessionOp(arbolito, [{ to: guard, data: encodeGuardSwap(path, amountIn, floor) }])], "session swap via guard");
    expect(events[0]!.args.success).toBe(true);
    expect(events[0]!.args.actualGasCost).toBe(0n);
    expect(await balance(USDT, account)).toBe(usdt0 - amountIn);
    expect((await balance(WARS, account)) - wars0).toBeGreaterThanOrEqual(floor);
    expect(await publicClient.readContract({ address: USDT, abi: erc20Abi, functionName: "allowance", args: [guard, ROUTER] })).toBe(0n);
    expect(await balance(USDT, guard)).toBe(0n);
    const swapped = parseEventLogs({ abi: sessionExecutorAbi, logs: receipt.logs, eventName: "Swapped" });
    expect(swapped).toHaveLength(1);
    expect(swapped[0]!.args.account).toBe(account);
    expect(swapped[0]!.args.floor).toBe(floor);
  });

  it("the session key pays a saved contact", async () => {
    const { events } = await relay([await sessionOp(arbolito, [{ to: guard, data: encodeGuardSend(USDT, contact, 5_000_000n) }])], "session send via guard");
    expect(events[0]!.args.success).toBe(true);
    expect(await balance(USDT, contact)).toBe(5_000_000n);
  });

  it("the session key cannot pay a stranger: the op lands but the guard reverts it and nothing moves", async () => {
    const data = encodeGuardSend(USDT, stranger, 1_000_000n);
    expect(await guardSays(data)).toBe(`NotRecipient(${stranger})`);
    const { events } = await relay([await sessionOp(arbolito, [{ to: guard, data }])], "session send to stranger (reverted)");
    expect(events[0]!.args.success).toBe(false);
    expect(await balance(USDT, stranger)).toBe(0n);
  });

  it("the session key cannot swap with minOut = 0 or below the floor", async () => {
    const path = encodeV3Path([USDT, WARS], [100]);
    const floor = await readMinOutFloor(publicClient, guard, account, path, 1_000_000n);
    expect(await guardSays(encodeGuardSwap(path, 1_000_000n, 0n))).toBe(`MinOutBelowFloor(0, ${floor})`);
    expect(await guardSays(encodeGuardSwap(path, 1_000_000n, floor - 1n))).toBe(`MinOutBelowFloor(${floor - 1n}, ${floor})`);
    const { events } = await relay([await sessionOp(arbolito, [{ to: guard, data: encodeGuardSwap(path, 1_000_000n, 0n) }])], "session swap minOut=0 (reverted)");
    expect(events[0]!.args.success).toBe(false);
  });

  it("the session key cannot raise its own caps or add contacts", async () => {
    const raise = await config({ limits: [{ token: USDT, maxPerTx: 10n ** 30n, maxPerDay: 10n ** 30n }], recipients: [{ recipient: stranger, allowed: true }] });
    // Signed by the session key: it is not an admin of the account.
    const keySig = await signConfigUpdate(arbolito, CHAIN_ID, guard, raise);
    expect(await guardSays(encodeApplyConfig(raise, keySig))).toBe(`NotAdmin(${arbolito.address})`);
    const { events } = await relay([await sessionOp(arbolito, [{ to: guard, data: encodeApplyConfig(raise, keySig) }])], "session applyConfig (reverted)");
    expect(events[0]!.args.success).toBe(false);
    // Over the per-tx cap is refused too.
    expect(await guardSays(encodeGuardSend(USDT, contact, LIMITS.usdtPerTx + 1n))).toBe(
      `ExceedsTxCap(${USDT}, ${LIMITS.usdtPerTx + 1n}, ${LIMITS.usdtPerTx})`,
    );
    // And the day cap: 10 swapped + 5 sent already today; 16 more would pass 30.
    expect(await guardSays(encodeGuardSend(USDT, contact, 16_000_000n))).toBe(`ExceedsDayCap(${USDT}, 15000000, ${LIMITS.usdtPerDay})`);
  });

  it("the session key cannot reach the router, the tokens or the account's permissions directly (AA24)", async () => {
    const toStranger = encodeFunctionData({
      abi: routerAbi,
      functionName: "exactInputSingle",
      args: [{ tokenIn: USDT, tokenOut: WARS, fee: 100, recipient: stranger, amountIn: 1_000_000n, amountOutMinimum: 0n, sqrtPriceLimitX96: 0n }],
    });
    expect(await simulate(await sessionOp(arbolito, [{ to: ROUTER, data: toStranger }]))).toBe("FailedOp(0, AA24 signature error)");
    const transfer = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [stranger, 1n] });
    expect(await simulate(await sessionOp(arbolito, [{ to: USDT, data: transfer }]))).toBe("FailedOp(0, AA24 signature error)");
    const approveMore = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [guard, 10n ** 30n] });
    expect(await simulate(await sessionOp(arbolito, [{ to: USDT, data: approveMore }]))).toBe("FailedOp(0, AA24 signature error)");
    const t = await now();
    const selfGrant = sessionKeyRequest({ signer: arbolito.address, approvedTargets: [ROUTER], validFrom: t, validUntil: t + 3600n });
    const selfSig = await signPermissionRequest(arbolito, CHAIN_ID, account, selfGrant);
    expect(await simulate(await sessionOp(arbolito, [{ to: account, data: encodeSetPermissionsForSigner(selfGrant, selfSig) }]))).toBe(
      "FailedOp(0, AA24 signature error)",
    );
  });

  it("the session key may pause the account (it can only make itself weaker); the admin unpauses", async () => {
    const { events } = await relay([await sessionOp(arbolito, [{ to: guard, data: encodeGuardPause() }])], "session pause");
    expect(events[0]!.args.success).toBe(true);
    expect(await guardSays(encodeGuardSend(USDT, contact, 1n))).toBe(`AccountPaused(${account})`);
    // The admin's signed unpause is submitted by the relayer directly: no UserOp needed.
    const unpause = await config({});
    const hash = await relayerWallet.sendTransaction({
      account: RELAYER,
      chain: celoMainnet,
      to: guard,
      data: encodeApplyConfig(unpause, await signConfigUpdate(user, CHAIN_ID, guard, unpause)),
    });
    const r = await publicClient.waitForTransactionReceipt({ hash });
    expect(r.status).toBe("success");
    gasReport.push(`applyConfig (unpause, relayer-submitted): gasUsed ${r.gasUsed}`);
    expect(await guardSays(encodeGuardSend(USDT, contact, 1n))).toBe("ok");

    console.log(`[guard v${kind.version}] guard ${guard} account ${account}\n  ${gasReport.join("\n  ")}`);
    // Nobody but the relayer spent CELO.
    expect(await publicClient.getBalance({ address: account })).toBe(0n);
    expect(formatEther(await publicClient.getBalance({ address: user.address }))).toBe("0");
  });
});
