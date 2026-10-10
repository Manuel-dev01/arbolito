/**
 * ArbolitoSessionExecutor ("the guard"): the only call target an Arbolito session key gets on a
 * user's thirdweb smart account. Contract: contracts/src/ArbolitoSessionExecutor.sol.
 *
 * - Session-key actions (msg.sender = the account): `swapExactInput`, `send`, `fillTextile`, `pause`.
 * - Config (caps, contacts, max slippage, pause, reference prices) only via `applyConfig` with an
 *   EIP-712 signature from an account admin. Anyone (the relayer) may submit it.
 *
 * Amounts are bigint atomic units throughout.
 */
import { encodeFunctionData, encodePacked, parseAbi, type Address, type Hex, type LocalAccount, type PublicClient } from "viem";
import { CONTRACTS, POOLS, TOKENS } from "@arbolito/config";

export const sessionExecutorAbi = parseAbi([
  "struct TokenLimit { address token; uint128 maxPerTx; uint128 maxPerDay; }",
  "struct Recipient { address recipient; bool allowed; }",
  "struct PriceRef { address tokenIn; address tokenOut; uint128 amountIn; uint128 amountOut; uint64 expiry; }",
  "struct ConfigUpdate { address account; uint256 nonce; uint256 deadline; bool paused; uint16 maxSlippageBps; TokenLimit[] limits; Recipient[] recipients; PriceRef[] prices; }",
  "constructor(address swapRouter, address factory, address reactor, uint32 twapWindow, address[] tokens, address[] pools)",
  "function swapExactInput(bytes path, uint256 amountIn, uint256 minOut) returns (uint256 amountOut)",
  "function send(address token, address to, uint256 amount)",
  "function fillTextile(address sellToken, uint256 maxSell, address buyToken, uint256 minBought, bytes reactorCall) returns (uint256 sold, uint256 bought)",
  "function pause()",
  "function applyConfig(ConfigUpdate u, bytes signature)",
  "function settings(address account) view returns (bool paused, uint16 maxSlippageBps, uint256 nonce)",
  "function limits(address account, address token) view returns (uint128 maxPerTx, uint128 maxPerDay)",
  "function spentToday(address account, address token) view returns (uint256)",
  "function isRecipient(address account, address recipient) view returns (bool)",
  "function isAllowedToken(address token) view returns (bool)",
  "function minOutFloor(address account, bytes path, uint256 amountIn) view returns (uint256)",
  "function twapQuote(address pool, address tokenIn, address tokenOut, uint256 amountIn) view returns (bool ok, uint256 amountOut)",
  "function twapWindow() view returns (uint32)",
  "event Swapped(address indexed account, address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut, uint256 minOut, uint256 floor)",
  "event Sent(address indexed account, address indexed token, address indexed to, uint256 amount)",
  "event TextileFilled(address indexed account, address indexed sellToken, address indexed buyToken, uint256 sold, uint256 bought, uint256 floor)",
  "event ConfigApplied(address indexed account, address indexed admin, uint256 nonce)",
  "event Paused(address indexed account)",
  "error ZeroAddress()",
  "error PoolMismatch(address pool)",
  "error TokenNotAllowed(address token)",
  "error PoolNotAllowed(address tokenA, address tokenB, uint24 fee)",
  "error BadPath()",
  "error AccountPaused(address account)",
  "error NotRecipient(address recipient)",
  "error ExceedsTxCap(address token, uint256 amount, uint256 cap)",
  "error ExceedsDayCap(address token, uint256 spentToday, uint256 cap)",
  "error ZeroAmount()",
  "error MinOutBelowFloor(uint256 minOut, uint256 floor)",
  "error NoPriceReference(address tokenIn, address tokenOut)",
  "error ExpiredSignature()",
  "error BadNonce(uint256 expected, uint256 got)",
  "error BadSignature()",
  "error NotAdmin(address signer)",
  "error SlippageTooHigh(uint16 bps)",
  "error BadPriceRef()",
  "error TransferFailed(address token)",
  "error Reentrancy()",
  "error UnexpectedBalance(address token)",
  "error TextileDisabled()",
  "error BadReactorCall()",
  "error ReactorCallFailed(bytes reason)",
  "error BoughtBelowMin(uint256 bought, uint256 minBought)",
]);

/** EIP-712 types for `applyConfig` (domain: name "ArbolitoSessionExecutor", version "1"). */
export const CONFIG_UPDATE_TYPES = {
  ConfigUpdate: [
    { name: "account", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "paused", type: "bool" },
    { name: "maxSlippageBps", type: "uint16" },
    { name: "limits", type: "TokenLimit[]" },
    { name: "recipients", type: "Recipient[]" },
    { name: "prices", type: "PriceRef[]" },
  ],
  TokenLimit: [
    { name: "token", type: "address" },
    { name: "maxPerTx", type: "uint128" },
    { name: "maxPerDay", type: "uint128" },
  ],
  Recipient: [
    { name: "recipient", type: "address" },
    { name: "allowed", type: "bool" },
  ],
  PriceRef: [
    { name: "tokenIn", type: "address" },
    { name: "tokenOut", type: "address" },
    { name: "amountIn", type: "uint128" },
    { name: "amountOut", type: "uint128" },
    { name: "expiry", type: "uint64" },
  ],
} as const;

export interface GuardTokenLimit {
  token: Address;
  /** Atomic units of `token`. */
  maxPerTx: bigint;
  /** Atomic units per UTC day. */
  maxPerDay: bigint;
}

export interface GuardRecipient {
  recipient: Address;
  allowed: boolean;
}

/** `amountIn` of tokenIn is worth at least `amountOut` of tokenOut until `expiry` (unix s). amountOut 0 clears it. */
export interface GuardPriceRef {
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  amountOut: bigint;
  expiry: bigint;
}

/** `paused` and `maxSlippageBps` are always written; the arrays are deltas. `nonce` must equal settings().nonce. */
export interface ConfigUpdate {
  account: Address;
  nonce: bigint;
  deadline: bigint;
  paused: boolean;
  maxSlippageBps: number;
  limits: readonly GuardTokenLimit[];
  recipients: readonly GuardRecipient[];
  prices: readonly GuardPriceRef[];
}

/** Mirrors the contract's MAX_SLIPPAGE_BPS. */
export const GUARD_MAX_SLIPPAGE_BPS = 1000;
/** Default TWAP window for the minOut floor. */
export const GUARD_TWAP_WINDOW_SECONDS = 600;

/**
 * Constructor args for a Celo mainnet deployment: SwapRouter02, the v3 factory, Textile's reactor,
 * a 10-minute TWAP, the five tokens Arbolito moves and the routable 0.01% pools.
 */
export function guardConstructorArgs(twapWindow = GUARD_TWAP_WINDOW_SECONDS) {
  const tokens: Address[] = [TOKENS.wARS.address, TOKENS.wBRL.address, TOKENS.USDT.address, TOKENS.USAT.address, TOKENS.USDC.address];
  const pools: Address[] = POOLS.filter((p) => p.routable).map((p) => p.address);
  return [CONTRACTS.uniswap.swapRouter02, CONTRACTS.uniswap.factory, CONTRACTS.textile.limitOrderReactor, twapWindow, tokens, pools] as const;
}

/** Uniswap v3 packed path: token | fee | token | fee | token ... */
export function encodeV3Path(tokens: readonly Address[], fees: readonly number[]): Hex {
  if (tokens.length < 2 || fees.length !== tokens.length - 1) throw new Error("path needs n tokens and n-1 fees");
  const types: ("address" | "uint24")[] = [];
  const values: (Address | number)[] = [];
  tokens.forEach((t, i) => {
    types.push("address");
    values.push(t);
    if (i < fees.length) {
      types.push("uint24");
      values.push(fees[i]!);
    }
  });
  return encodePacked(types, values);
}

export function configTypedData(chainId: number, guard: Address, u: ConfigUpdate) {
  return {
    domain: { name: "ArbolitoSessionExecutor", version: "1", chainId, verifyingContract: guard },
    types: CONFIG_UPDATE_TYPES,
    primaryType: "ConfigUpdate" as const,
    message: { ...u, limits: [...u.limits], recipients: [...u.recipients], prices: [...u.prices] },
  };
}

/** The account admin's EIP-712 signature over a config update. Never sign this with a session key. */
export async function signConfigUpdate(admin: LocalAccount, chainId: number, guard: Address, u: ConfigUpdate): Promise<Hex> {
  return admin.signTypedData(configTypedData(chainId, guard, u));
}

export function encodeApplyConfig(u: ConfigUpdate, signature: Hex): Hex {
  return encodeFunctionData({
    abi: sessionExecutorAbi,
    functionName: "applyConfig",
    args: [{ ...u, limits: [...u.limits], recipients: [...u.recipients], prices: [...u.prices] }, signature],
  });
}

export function encodeGuardSwap(path: Hex, amountIn: bigint, minOut: bigint): Hex {
  return encodeFunctionData({ abi: sessionExecutorAbi, functionName: "swapExactInput", args: [path, amountIn, minOut] });
}

export function encodeGuardSend(token: Address, to: Address, amount: bigint): Hex {
  return encodeFunctionData({ abi: sessionExecutorAbi, functionName: "send", args: [token, to, amount] });
}

export function encodeGuardFillTextile(p: {
  sellToken: Address;
  maxSell: bigint;
  buyToken: Address;
  minBought: bigint;
  /** Textile's `transactions.swap` calldata (reactor `execute`/`executeBatch`). */
  reactorCall: Hex;
}): Hex {
  return encodeFunctionData({
    abi: sessionExecutorAbi,
    functionName: "fillTextile",
    args: [p.sellToken, p.maxSell, p.buyToken, p.minBought, p.reactorCall],
  });
}

export function encodeGuardPause(): Hex {
  return encodeFunctionData({ abi: sessionExecutorAbi, functionName: "pause" });
}

/** Current config nonce for `account` (the next ConfigUpdate must carry it). */
export async function readGuardNonce(client: PublicClient, guard: Address, account: Address): Promise<bigint> {
  const [, , nonce] = await client.readContract({ address: guard, abi: sessionExecutorAbi, functionName: "settings", args: [account] });
  return nonce;
}

/** Lowest `minOut` the guard accepts for this swap right now (TWAP and/or signed reference, less max slippage). */
export async function readMinOutFloor(client: PublicClient, guard: Address, account: Address, path: Hex, amountIn: bigint): Promise<bigint> {
  return client.readContract({ address: guard, abi: sessionExecutorAbi, functionName: "minOutFloor", args: [account, path, amountIn] });
}
