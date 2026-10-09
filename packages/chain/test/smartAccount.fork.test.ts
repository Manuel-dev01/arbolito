/**
 * Spike: can Arbolito self-bundle a thirdweb smart account's UserOps on Celo?
 *
 * The user's thirdweb account (admin = a fresh EOA that never holds CELO) grants Arbolito a
 * session key scoped to SwapRouter02. Arbolito's relayer EOA calls EntryPoint.handleOps itself,
 * with maxFeePerGas = maxPriorityFeePerGas = 0 in every op: no bundler, no paymaster, no
 * prefund. Runs against both EntryPoint v0.6 and v0.7 with thirdweb's default factories.
 * Fork only: every send goes to the anvil instance started by test/fork-setup.ts.
 */
import { beforeAll, describe, expect, inject, it } from "vitest";
import {
  createTestClient,
  createWalletClient,
  decodeErrorResult,
  encodeFunctionData,
  formatEther,
  http,
  maxUint256,
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
import { fromEntryPointCalldata, verifyTx, verifyUserOps } from "@celo/attribution-tags";
import { CONTRACTS, POOLS, TOKENS } from "@arbolito/config";
import {
  FORK_ATTRIBUTION_CODE,
  THIRDWEB_ACCOUNT_V06,
  THIRDWEB_ACCOUNT_V07,
  accountInitCode,
  buildZeroFeeUserOp,
  celoMainnet,
  encodeAccountCalls,
  encodeHandleOps,
  encodeSetPermissionsForSigner,
  getAccountNonce,
  isAnvil,
  makePublicClient,
  makeWalletClient,
  predictAccountAddress,
  revokeSessionKeyRequest,
  sessionKeyRequest,
  signPermissionRequest,
  signUserOp,
  thirdwebAccountAbi,
  userOpHash,
  type Call,
  type ThirdwebAccountKind,
  type UserOp,
} from "../src";

const CHAIN_ID = 42220;
const CODE = FORK_ATTRIBUTION_CODE;
const ROUTER = CONTRACTS.uniswap.swapRouter02;
const WBRL = TOKENS.wBRL.address;
const USDT = TOKENS.USDT.address;
const WBRL_POOL = POOLS.find((p) => p.name.startsWith("wBRL/USDT"))!.address;
// Fresh relayer key: anvil's well-known dev addresses carry EIP-7702 sweeper delegations on Celo
// mainnet (and so on the fork), which drain any balance when the EntryPoint pays the beneficiary.
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
  "function pull(address token, uint256 value) payable",
  "function sweepToken(address token, uint256 amountMinimum, address recipient) payable",
]);
const quoterAbi = parseAbi([
  "struct QuoteExactInputSingleParams { address tokenIn; address tokenOut; uint256 amountIn; uint24 fee; uint160 sqrtPriceLimitX96; }",
  "function quoteExactInputSingle(QuoteExactInputSingleParams params) view returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
]);

/** Pulls revert data out of a viem error chain and decodes the EntryPoint's FailedOp. */
function failedOp(err: unknown, kind: ThirdwebAccountKind): string {
  const abi = kind.version === "0.6" ? entryPoint06Abi : entryPoint07Abi;
  for (let e = err as { cause?: unknown; data?: unknown } | undefined; e; e = e.cause as typeof e) {
    const data = typeof e.data === "string" ? e.data : (e.data as { data?: unknown } | undefined)?.data;
    if (typeof data === "string" && data.startsWith("0x") && data.length >= 10) {
      try {
        const r = decodeErrorResult({ abi, data: data as Hex });
        return `${r.errorName}(${(r.args ?? []).map(String).join(", ")})`;
      } catch {
        /* not an EntryPoint error; keep walking */
      }
    }
  }
  return `undecoded: ${(err as Error).message.split("\n")[0]}`;
}

describe.each([THIRDWEB_ACCOUNT_V06, THIRDWEB_ACCOUNT_V07])("self-bundled thirdweb account, EntryPoint v$version", (kind) => {
  let publicClient: PublicClient;
  let relayerWallet: WalletClient;
  let rpcUrl: string;
  // Fresh keys per run: the user never holds CELO; Arbolito's session keys never hold anything.
  const user = privateKeyToAccount(generatePrivateKey());
  const arbolito = privateKeyToAccount(generatePrivateKey());
  const stranger = privateKeyToAccount(generatePrivateKey()).address;
  let account: Address;
  const gasReport: string[] = [];

  const balance = (token: Address, who: Address) =>
    publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [who] });
  const now = async () => (await publicClient.getBlock()).timestamp;

  async function sessionOp(signer: PrivateKeyAccount, calls: readonly Call[], attributionCode?: string): Promise<UserOp> {
    const nonce = await getAccountNonce(publicClient, kind, account);
    const op = buildZeroFeeUserOp({ sender: account, nonce, callData: encodeAccountCalls(calls), attributionCode });
    return signUserOp(signer, kind, CHAIN_ID, op);
  }

  /** eth_call of handleOps from the relayer: "ok" or the decoded FailedOp. */
  async function simulate(op: UserOp): Promise<string> {
    try {
      await publicClient.call({ account: RELAYER.address, to: kind.entryPoint, data: encodeHandleOps(kind, [op], RELAYER.address) });
      return "ok";
    } catch (err) {
      return failedOp(err, kind);
    }
  }

  /** The relayer submits handleOps itself and pays the gas. */
  async function relay(ops: UserOp[], label: string, outerCode?: string) {
    const data = encodeHandleOps(kind, ops, RELAYER.address, outerCode);
    const celoBefore = await publicClient.getBalance({ address: RELAYER.address });
    const gas = await publicClient.estimateGas({ account: RELAYER.address, to: kind.entryPoint, data });
    const hash = await relayerWallet.sendTransaction({
      account: RELAYER,
      chain: celoMainnet,
      to: kind.entryPoint,
      data,
      gas: (gas * 12n) / 10n,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    expect(receipt.status).toBe("success");
    const events = parseEventLogs({ abi: entryPoint06Abi, logs: receipt.logs, eventName: "UserOperationEvent" });
    const paid = celoBefore - (await publicClient.getBalance({ address: RELAYER.address }));
    expect(paid).toBe(receipt.gasUsed * receipt.effectiveGasPrice);
    gasReport.push(
      `${label}: gasUsed ${receipt.gasUsed} @ ${formatEther(receipt.effectiveGasPrice, "gwei")} gwei = ${formatEther(paid)} CELO (relayer)`,
    );
    return { hash, receipt, events };
  }

  beforeAll(async () => {
    rpcUrl = inject("forkRpcUrl");
    publicClient = makePublicClient({ rpcUrl, pollingInterval: 100 });
    expect(await isAnvil(publicClient)).toBe(true);
    relayerWallet = makeWalletClient(RELAYER, { rpcUrl, pollingInterval: 100 });
    const testClient = createTestClient({ mode: "anvil", chain: celoMainnet, transport: http(rpcUrl) });
    await testClient.setBalance({ address: RELAYER.address, value: parseEther("10") });

    account = await predictAccountAddress(publicClient, kind, user.address);
    expect(await publicClient.getCode({ address: account })).toBeUndefined();

    // 100 wBRL to the counterfactual account, borrowed from the pool via impersonation.
    await testClient.setBalance({ address: WBRL_POOL, value: parseEther("1") });
    await testClient.impersonateAccount({ address: WBRL_POOL });
    const pool = createWalletClient({ account: WBRL_POOL, chain: celoMainnet, transport: http(rpcUrl), pollingInterval: 100 });
    const fund = await pool.writeContract({ address: WBRL, abi: erc20Abi, functionName: "transfer", args: [account, parseEther("100")] });
    await publicClient.waitForTransactionReceipt({ hash: fund });
    await testClient.stopImpersonatingAccount({ address: WBRL_POOL });
  });

  it("onboards in one zero-fee UserOp signed by the admin: deploy + approve SwapRouter02 + grant the session key", async () => {
    const t = await now();
    const grant = sessionKeyRequest({ signer: arbolito.address, approvedTargets: [ROUTER], validFrom: t - 60n, validUntil: t + 86_400n });
    // EIP-712 over the counterfactual address: the account verifies it once deployed, in the same op.
    const grantSig = await signPermissionRequest(user, CHAIN_ID, account, grant);
    const op = await signUserOp(
      user,
      kind,
      CHAIN_ID,
      buildZeroFeeUserOp({
        sender: account,
        nonce: 0n,
        initCode: accountInitCode(kind, user.address),
        callData: encodeAccountCalls([
          { to: WBRL, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [ROUTER, maxUint256] }) },
          { to: account, data: encodeSetPermissionsForSigner(grant, grantSig) },
        ]),
      }),
    );

    const { events } = await relay([op], "onboarding (deploy+approve+grant)", CODE);
    expect(events).toHaveLength(1);
    expect(events[0]!.args.success).toBe(true);
    expect(events[0]!.args.actualGasCost).toBe(0n); // zero-fee op: the account is charged nothing
    expect(events[0]!.args.sender).toBe(account);
    expect(events[0]!.args.userOpHash).toBe(userOpHash(kind, CHAIN_ID, op));

    expect(await publicClient.getCode({ address: account })).toBeDefined();
    const read = <T>(functionName: "isAdmin" | "isActiveSigner", who: Address) =>
      publicClient.readContract({ address: account, abi: thirdwebAccountAbi, functionName, args: [who] }) as Promise<T>;
    expect(await read<boolean>("isAdmin", user.address)).toBe(true);
    expect(await read<boolean>("isAdmin", arbolito.address)).toBe(false);
    expect(await read<boolean>("isActiveSigner", arbolito.address)).toBe(true);
    const perms = await publicClient.readContract({ address: account, abi: thirdwebAccountAbi, functionName: "getPermissionsForSigner", args: [arbolito.address] });
    expect(perms.approvedTargets).toEqual([ROUTER]);
    expect(perms.endTimestamp).toBe(grant.permissionEndTimestamp);
    expect(await publicClient.readContract({ address: WBRL, abi: erc20Abi, functionName: "allowance", args: [account, ROUTER] })).toBe(maxUint256);
    // Nobody but the relayer spent CELO.
    expect(await publicClient.getBalance({ address: user.address })).toBe(0n);
    expect(await publicClient.getBalance({ address: account })).toBe(0n);
  });

  it("session key swaps 10 wBRL → USDT to the account; relayer pays gas; inner + outer attribution", async () => {
    const amountIn = parseEther("10");
    const [quoted] = await publicClient.readContract({
      address: CONTRACTS.uniswap.quoterV2,
      abi: quoterAbi,
      functionName: "quoteExactInputSingle",
      args: [{ tokenIn: WBRL, tokenOut: USDT, amountIn, fee: 100, sqrtPriceLimitX96: 0n }],
    });
    const minOut = (quoted * 995n) / 1000n;
    const swap = encodeFunctionData({
      abi: routerAbi,
      functionName: "exactInputSingle",
      args: [{ tokenIn: WBRL, tokenOut: USDT, fee: 100, recipient: account, amountIn, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n }],
    });
    const [wbrl0, usdt0] = await Promise.all([balance(WBRL, account), balance(USDT, account)]);

    const op = await sessionOp(arbolito, [{ to: ROUTER, data: swap }], CODE);
    const { hash, events } = await relay([op], "session swap (execute → exactInputSingle)", CODE);
    expect(events[0]!.args.success).toBe(true);
    expect(events[0]!.args.actualGasCost).toBe(0n);
    expect(await balance(WBRL, account)).toBe(wbrl0 - amountIn);
    expect((await balance(USDT, account)) - usdt0).toBe(quoted); // nothing else trades on the fork
    expect(await publicClient.getBalance({ address: account })).toBe(0n);

    // Attribution, both placements present. verifyTx reads the outer suffix first (no sender);
    // verifyUserOps decodes the op's callData suffix and credits the smart account.
    expect(await verifyTx({ client: publicClient, hash })).toEqual({ codes: [CODE], schemaId: 0 });
    const ops = await verifyUserOps({ client: publicClient, hash });
    // The SDK reports `sender` lowercased.
    const sender = account.toLowerCase();
    expect(ops).toEqual([{ sender, attribution: { codes: [CODE], schemaId: 0 } }]);
    const tx = await publicClient.getTransaction({ hash });
    expect(tx.from.toLowerCase()).toBe(RELAYER.address.toLowerCase()); // the tx itself is the relayer's
    expect(fromEntryPointCalldata(tx.input)).toEqual(ops);
  });

  it("attribution: inner-only tag makes verifyTx credit the smart account; outer-only credits nobody but the tx", async () => {
    const swap = (amountIn: bigint) =>
      encodeFunctionData({
        abi: routerAbi,
        functionName: "exactInputSingle",
        args: [{ tokenIn: WBRL, tokenOut: USDT, fee: 100, recipient: account, amountIn, amountOutMinimum: 1n, sqrtPriceLimitX96: 0n }],
      });

    const inner = await relay([await sessionOp(arbolito, [{ to: ROUTER, data: swap(parseEther("1")) }], CODE)], "session swap (inner tag only)");
    expect(await verifyTx({ client: publicClient, hash: inner.hash })).toEqual({ codes: [CODE], schemaId: 0, sender: account.toLowerCase() });

    const outer = await relay([await sessionOp(arbolito, [{ to: ROUTER, data: swap(parseEther("1")) }])], "session swap (outer tag only)", CODE);
    expect(await verifyTx({ client: publicClient, hash: outer.hash })).toEqual({ codes: [CODE], schemaId: 0 });
    expect(await verifyUserOps({ client: publicClient, hash: outer.hash })).toEqual([{ sender: account.toLowerCase(), attribution: null }]);
  });

  it("rejects a session-key op that calls a non-approved target (wBRL.transfer to a stranger)", async () => {
    const steal = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [stranger, parseEther("1")] });
    expect(await simulate(await sessionOp(arbolito, [{ to: WBRL, data: steal }]))).toBe("FailedOp(0, AA24 signature error)");
    // Smuggling it into a batch next to an approved target fails the same way.
    const batch = [
      { to: ROUTER, data: encodeFunctionData({ abi: routerAbi, functionName: "pull", args: [WBRL, 1n] }) },
      { to: WBRL, data: steal },
    ];
    expect(await simulate(await sessionOp(arbolito, batch))).toBe("FailedOp(0, AA24 signature error)");
    // So does calling the account itself (e.g. to grant itself more permissions).
    const selfCall = { to: account, data: encodeFunctionData({ abi: thirdwebAccountAbi, functionName: "isAdmin", args: [arbolito.address] }) };
    expect(await simulate(await sessionOp(arbolito, [selfCall]))).toBe("FailedOp(0, AA24 signature error)");
    // Native value above nativeTokenLimitPerTransaction (0) is rejected too.
    expect(await simulate(await sessionOp(arbolito, [{ to: ROUTER, value: 1n, data: "0x" }]))).toBe("FailedOp(0, AA24 signature error)");
    // An op signed by a key with no permissions at all.
    const nobody = privateKeyToAccount(generatePrivateKey());
    expect(await simulate(await sessionOp(nobody, [{ to: ROUTER, data: "0x" }]))).toBe("FailedOp(0, AA24 signature error)");
  });

  it("KNOWN GAP: a key scoped to SwapRouter02 can still send the account's tokens to any address", async () => {
    // isValidSigner checks the target and value only, never the inner calldata. SwapRouter02's
    // own functions then route funds anywhere: a swap with recipient = stranger, or pull + sweepToken.
    const toStranger = encodeFunctionData({
      abi: routerAbi,
      functionName: "exactInputSingle",
      args: [{ tokenIn: WBRL, tokenOut: USDT, fee: 100, recipient: stranger, amountIn: parseEther("1"), amountOutMinimum: 1n, sqrtPriceLimitX96: 0n }],
    });
    const drain = [
      { to: ROUTER, data: encodeFunctionData({ abi: routerAbi, functionName: "pull", args: [WBRL, parseEther("5")] }) },
      { to: ROUTER, data: encodeFunctionData({ abi: routerAbi, functionName: "sweepToken", args: [WBRL, 0n, stranger] }) },
    ];
    const swapOut = await relay([await sessionOp(arbolito, [{ to: ROUTER, data: toStranger }])], "gap: swap to stranger");
    expect(swapOut.events[0]!.args.success).toBe(true);
    expect(await balance(USDT, stranger)).toBeGreaterThan(0n);
    const swept = await relay([await sessionOp(arbolito, drain)], "gap: pull + sweepToken to stranger");
    expect(swept.events[0]!.args.success).toBe(true);
    expect(await balance(WBRL, stranger)).toBe(parseEther("5"));
  });

  it("the admin revokes the session key with a signed request that the relayer submits; the key stops working", async () => {
    const swap = encodeFunctionData({
      abi: routerAbi,
      functionName: "exactInputSingle",
      args: [{ tokenIn: WBRL, tokenOut: USDT, fee: 100, recipient: account, amountIn: parseEther("1"), amountOutMinimum: 1n, sqrtPriceLimitX96: 0n }],
    });
    expect(await simulate(await sessionOp(arbolito, [{ to: ROUTER, data: swap }]))).toBe("ok");

    const revoke = revokeSessionKeyRequest(arbolito.address, (await now()) + 3600n);
    const sig = await signPermissionRequest(user, CHAIN_ID, account, revoke);
    // setPermissionsForSigner checks the admin's signature, not msg.sender: no UserOp needed.
    const hash = await relayerWallet.sendTransaction({ account: RELAYER, chain: celoMainnet, to: account, data: encodeSetPermissionsForSigner(revoke, sig) });
    expect((await publicClient.waitForTransactionReceipt({ hash })).status).toBe("success");

    expect(await publicClient.readContract({ address: account, abi: thirdwebAccountAbi, functionName: "isActiveSigner", args: [arbolito.address] })).toBe(false);
    expect(await simulate(await sessionOp(arbolito, [{ to: ROUTER, data: swap }]))).toBe("FailedOp(0, AA24 signature error)");
    // A replayed signed request is refused (uid is single-use).
    await expect(
      publicClient.call({ account: RELAYER.address, to: account, data: encodeSetPermissionsForSigner(revoke, sig) }),
    ).rejects.toThrow(/!sig/);
  });

  it("an expired session key is rejected", async () => {
    // A second key with a short window; wait for the fork clock to pass it (no time travel, so
    // other fork suites sharing this anvil are unaffected).
    const shortKey = privateKeyToAccount(generatePrivateKey());
    const t = await now();
    const grant = sessionKeyRequest({ signer: shortKey.address, approvedTargets: [ROUTER], validFrom: t - 60n, validUntil: t + 8n });
    const sig = await signPermissionRequest(user, CHAIN_ID, account, grant);
    const hash = await relayerWallet.sendTransaction({ account: RELAYER, chain: celoMainnet, to: account, data: encodeSetPermissionsForSigner(grant, sig) });
    expect((await publicClient.waitForTransactionReceipt({ hash })).status).toBe("success");

    const swap = encodeFunctionData({
      abi: routerAbi,
      functionName: "exactInputSingle",
      args: [{ tokenIn: WBRL, tokenOut: USDT, fee: 100, recipient: account, amountIn: parseEther("1"), amountOutMinimum: 1n, sqrtPriceLimitX96: 0n }],
    });
    expect(await simulate(await sessionOp(shortKey, [{ to: ROUTER, data: swap }]))).toBe("ok");
    while ((await now()) < grant.permissionEndTimestamp) await new Promise((r) => setTimeout(r, 500));
    expect(await simulate(await sessionOp(shortKey, [{ to: ROUTER, data: swap }]))).toBe("FailedOp(0, AA24 signature error)");

    console.log(`[smartAccount v${kind.version}] account ${account}\n  ${gasReport.join("\n  ")}`);
  });
});
