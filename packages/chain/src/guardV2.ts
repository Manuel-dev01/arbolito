/**
 * ArbolitoGuard (v2, MiniPay-native). Contract: contracts/src/ArbolitoGuard.sol.
 *
 * The account is a plain EOA (a MiniPay wallet). It sends its own onboarding txs:
 *   1. `token.approve(guard, bounded)`: the hard ceiling on what the guard can move
 *   2. `configure(cfg)`: caps, contacts, max slippage, price refs (cfg.account must be the sender)
 *   3. `setOperator(arbolito, expiry)`
 * The operator then calls `swapFor` / `sendFor` / `pause` for that account. It can never
 * configure or unpause. There is no Textile path (firm quotes are taker-exclusive onchain).
 *
 * Amounts are bigint atomic units throughout.
 */
import { encodeFunctionData, parseAbi, type Address, type Hex, type PublicClient } from "viem";
import { CONTRACTS, POOLS, TOKENS } from "@arbolito/config";
import { GUARD_TWAP_WINDOW_SECONDS, type GuardPriceRef, type GuardRecipient, type GuardTokenLimit } from "./guard";

export const arbolitoGuardAbi = parseAbi([
  "struct TokenLimit { address token; uint128 maxPerTx; uint128 maxPerDay; }",
  "struct Recipient { address recipient; bool allowed; }",
  "struct PriceRef { address tokenIn; address tokenOut; uint128 amountIn; uint128 amountOut; uint64 expiry; }",
  "struct Config { address account; bool paused; uint16 maxSlippageBps; TokenLimit[] limits; Recipient[] recipients; PriceRef[] prices; }",
  "constructor(address swapRouter, address factory, uint32 twapWindow, address[] tokens, address[] pools)",
  // account only
  "function setOperator(address operator, uint64 expiry)",
  "function revokeOperator()",
  "function configure(Config c)",
  // account or its active operator
  "function pause(address account)",
  "function swapFor(address account, bytes path, uint256 amountIn, uint256 minOut) returns (uint256 amountOut)",
  "function sendFor(address account, address token, address to, uint256 amount)",
  // views
  "function isActiveOperator(address account, address who) view returns (bool)",
  "function operatorOf(address account) view returns (address operator, uint64 expiry, bool active)",
  "function settings(address account) view returns (bool configured, bool paused, uint16 maxSlippageBps)",
  "function limits(address account, address token) view returns (uint128 maxPerTx, uint128 maxPerDay)",
  "function spentToday(address account, address token) view returns (uint256)",
  "function isRecipient(address account, address recipient) view returns (bool)",
  "function priceRef(address account, address tokenIn, address tokenOut) view returns (uint128 amountIn, uint128 amountOut, uint64 expiry)",
  "function isAllowedToken(address token) view returns (bool)",
  "function isPinnedPool(address pool) view returns (bool)",
  "function poolFor(address tokenA, address tokenB, uint24 fee) view returns (address)",
  "function minOutFloor(address account, bytes path, uint256 amountIn) view returns (uint256)",
  "function twapQuote(address pool, address tokenIn, address tokenOut, uint256 amountIn) view returns (bool ok, uint256 amountOut)",
  "function twapWindow() view returns (uint32)",
  "function swapRouter() view returns (address)",
  "function MAX_SLIPPAGE_BPS() view returns (uint16)",
  // events
  "event OperatorSet(address indexed account, address indexed operator, uint64 expiry)",
  "event OperatorRevoked(address indexed account, address indexed operator)",
  "event Configured(address indexed account)",
  "event SettingsSet(address indexed account, bool paused, uint16 maxSlippageBps)",
  "event TokenLimitSet(address indexed account, address indexed token, uint128 maxPerTx, uint128 maxPerDay)",
  "event RecipientSet(address indexed account, address indexed recipient, bool allowed)",
  "event PriceRefSet(address indexed account, address indexed tokenIn, address indexed tokenOut, uint128 amountIn, uint128 amountOut, uint64 expiry)",
  "event Paused(address indexed account, address indexed by)",
  "event Swapped(address indexed account, address indexed tokenIn, address indexed tokenOut, address by, uint256 amountIn, uint256 amountOut, uint256 minOut, uint256 floor)",
  "event Sent(address indexed account, address indexed token, address indexed to, address by, uint256 amount)",
  // errors
  "error ZeroAddress()",
  "error PoolMismatch(address pool)",
  "error TokenNotAllowed(address token)",
  "error PoolNotAllowed(address tokenA, address tokenB, uint24 fee)",
  "error BadPath()",
  "error NotAccount(address caller, address account)",
  "error NotOperator(address caller, address account)",
  "error BadOperator(address operator)",
  "error BadExpiry(uint64 expiry)",
  "error NotConfigured(address account)",
  "error AccountPaused(address account)",
  "error NotRecipient(address recipient)",
  "error BadRecipient(address recipient)",
  "error ExceedsTxCap(address token, uint256 amount, uint256 cap)",
  "error ExceedsDayCap(address token, uint256 spentToday, uint256 cap)",
  "error ZeroAmount()",
  "error MinOutBelowFloor(uint256 minOut, uint256 floor)",
  "error NoPriceReference(address tokenIn, address tokenOut)",
  "error SlippageTooHigh(uint16 bps)",
  "error BadPriceRef()",
  "error TransferFailed(address token)",
  "error Reentrancy()",
  "error UnexpectedBalance(address token)",
]);

/**
 * `account` must be the tx sender. `paused` and `maxSlippageBps` are always written, and the
 * arrays are deltas. Sending `paused: false` is the only way to unpause.
 */
export interface GuardV2Config {
  account: Address;
  paused: boolean;
  maxSlippageBps: number;
  limits: readonly GuardTokenLimit[];
  recipients: readonly GuardRecipient[];
  prices: readonly GuardPriceRef[];
}

/** Mirrors the contract's MAX_SLIPPAGE_BPS. */
export const GUARD_V2_MAX_SLIPPAGE_BPS = 1000;

/** Constructor args for Celo mainnet: SwapRouter02, the v3 factory, a 10-minute TWAP, five tokens, the routable 0.01% pools. */
export function guardV2ConstructorArgs(twapWindow = GUARD_TWAP_WINDOW_SECONDS) {
  const tokens: Address[] = [TOKENS.wARS.address, TOKENS.wBRL.address, TOKENS.USDT.address, TOKENS.USAT.address, TOKENS.USDC.address];
  const pools: Address[] = POOLS.filter((p) => p.guard).map((p) => p.address);
  return [CONTRACTS.uniswap.swapRouter02, CONTRACTS.uniswap.factory, twapWindow, tokens, pools] as const;
}

// ---------------------------------------------------------------- encoders (account)
/** Sent by the account's EOA. `expiry` is unix seconds; the operator is active while now < expiry. */
export function encodeGuardV2SetOperator(operator: Address, expiry: bigint): Hex {
  return encodeFunctionData({ abi: arbolitoGuardAbi, functionName: "setOperator", args: [operator, expiry] });
}

export function encodeGuardV2RevokeOperator(): Hex {
  return encodeFunctionData({ abi: arbolitoGuardAbi, functionName: "revokeOperator" });
}

/** Sent by the account's EOA. cfg.account must equal the sender or the guard reverts NotAccount. */
export function encodeGuardV2Configure(cfg: GuardV2Config): Hex {
  if (cfg.maxSlippageBps < 0 || cfg.maxSlippageBps > GUARD_V2_MAX_SLIPPAGE_BPS) {
    throw new Error(`maxSlippageBps must be 0..${GUARD_V2_MAX_SLIPPAGE_BPS}`);
  }
  return encodeFunctionData({
    abi: arbolitoGuardAbi,
    functionName: "configure",
    args: [{ ...cfg, limits: [...cfg.limits], recipients: [...cfg.recipients], prices: [...cfg.prices] }],
  });
}

// ---------------------------------------------------------------- encoders (account or operator)
export function encodeGuardV2Pause(account: Address): Hex {
  return encodeFunctionData({ abi: arbolitoGuardAbi, functionName: "pause", args: [account] });
}

/** `path` from encodeV3Path. Output always goes to `account`. `minOut` must be >= readGuardV2MinOutFloor. */
export function encodeGuardV2SwapFor(account: Address, path: Hex, amountIn: bigint, minOut: bigint): Hex {
  return encodeFunctionData({ abi: arbolitoGuardAbi, functionName: "swapFor", args: [account, path, amountIn, minOut] });
}

/** `to` must be one of the account's saved contacts. */
export function encodeGuardV2SendFor(account: Address, token: Address, to: Address, amount: bigint): Hex {
  return encodeFunctionData({ abi: arbolitoGuardAbi, functionName: "sendFor", args: [account, token, to, amount] });
}

// ---------------------------------------------------------------- readers
export interface GuardV2Operator {
  operator: Address;
  expiry: bigint;
  active: boolean;
}

export async function readGuardV2Operator(client: PublicClient, guard: Address, account: Address): Promise<GuardV2Operator> {
  const [operator, expiry, active] = await client.readContract({ address: guard, abi: arbolitoGuardAbi, functionName: "operatorOf", args: [account] });
  return { operator, expiry, active };
}

export interface GuardV2Settings {
  configured: boolean;
  paused: boolean;
  maxSlippageBps: number;
}

export async function readGuardV2Settings(client: PublicClient, guard: Address, account: Address): Promise<GuardV2Settings> {
  const [configured, paused, maxSlippageBps] = await client.readContract({ address: guard, abi: arbolitoGuardAbi, functionName: "settings", args: [account] });
  return { configured, paused, maxSlippageBps };
}

export interface GuardV2TokenBudget {
  maxPerTx: bigint;
  maxPerDay: bigint;
  spentToday: bigint;
  /** What can still move today, bounded by both caps. */
  available: bigint;
}

/** Caps and today's spend for one token (UTC day buckets, as the contract counts them). */
export async function readGuardV2Budget(client: PublicClient, guard: Address, account: Address, token: Address): Promise<GuardV2TokenBudget> {
  const [[maxPerTx, maxPerDay], spentToday] = await Promise.all([
    client.readContract({ address: guard, abi: arbolitoGuardAbi, functionName: "limits", args: [account, token] }),
    client.readContract({ address: guard, abi: arbolitoGuardAbi, functionName: "spentToday", args: [account, token] }),
  ]);
  const leftToday = maxPerDay > spentToday ? maxPerDay - spentToday : 0n;
  return { maxPerTx, maxPerDay, spentToday, available: leftToday < maxPerTx ? leftToday : maxPerTx };
}

export async function readGuardV2IsContact(client: PublicClient, guard: Address, account: Address, to: Address): Promise<boolean> {
  return client.readContract({ address: guard, abi: arbolitoGuardAbi, functionName: "isRecipient", args: [account, to] });
}

/** Lowest `minOut` the guard accepts for this swap right now (TWAP or the account's price ref, stricter, less max slippage). */
export async function readGuardV2MinOutFloor(client: PublicClient, guard: Address, account: Address, path: Hex, amountIn: bigint): Promise<bigint> {
  return client.readContract({ address: guard, abi: arbolitoGuardAbi, functionName: "minOutFloor", args: [account, path, amountIn] });
}
