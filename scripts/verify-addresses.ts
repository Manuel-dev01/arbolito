/**
 * pnpm verify:addresses
 * Checks every address in packages/config against Celo mainnet:
 *  - tokens: symbol() and decimals() match config
 *  - fee adapters: wrap the right token and are listed in FeeCurrencyDirectory
 *  - pools: token0/token1/fee match config and factory.getPool() agrees
 *  - contracts: code exists; Uniswap periphery reports the configured factory
 * Exits non-zero on any mismatch. Read-only; sends no transactions.
 */
import { createPublicClient, fallback, http, parseAbi, type Address } from "viem";
import { celoMainnet as celo } from "@arbolito/chain";
import { CONTRACTS, POOLS, TOKENS, loadEnv } from "@arbolito/config";

const env = loadEnv();
const transports = [http(env.CELO_RPC_URL, { batch: true, retryCount: 3 })];
if (env.CELO_RPC_URL_FALLBACK) transports.push(http(env.CELO_RPC_URL_FALLBACK, { batch: true, retryCount: 3 }));
const client = createPublicClient({ chain: celo, transport: fallback(transports) });

const erc20 = parseAbi(["function symbol() view returns (string)", "function decimals() view returns (uint8)"]);
const pool = parseAbi([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function fee() view returns (uint24)",
]);
const factoryAbi = parseAbi(["function getPool(address,address,uint24) view returns (address)"]);
const periphery = parseAbi(["function factory() view returns (address)"]);
const adapterAbi = parseAbi([
  "function getAdaptedToken() view returns (address)",
  "function adaptedToken() view returns (address)",
]);
const directoryAbi = parseAbi(["function getCurrencies() view returns (address[])"]);
const registryAbi = parseAbi(["function getAddressForStringOrDie(string) view returns (address)"]);

type Row = { kind: string; name: string; check: string; expected: string; actual: string; ok: boolean };
const rows: Row[] = [];
const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const add = (kind: string, name: string, check: string, expected: unknown, actual: unknown, ok?: boolean) =>
  rows.push({
    kind,
    name,
    check,
    expected: String(expected),
    actual: String(actual),
    ok: ok ?? eq(String(expected), String(actual)),
  });

const blockNumber = await client.getBlockNumber();

// ── Tokens ──────────────────────────────────────────────
const tokens = Object.values(TOKENS);
const tokenResults = await client.multicall({
  allowFailure: true,
  blockNumber,
  contracts: tokens.flatMap((t) => [
    { address: t.address, abi: erc20, functionName: "symbol" } as const,
    { address: t.address, abi: erc20, functionName: "decimals" } as const,
  ]),
});
tokens.forEach((t, i) => {
  const sym = tokenResults[i * 2]!;
  const dec = tokenResults[i * 2 + 1]!;
  add("token", t.symbol, "symbol", t.onchainSymbol, sym.status === "success" ? sym.result : `ERR ${sym.error?.message.slice(0, 60)}`);
  add("token", t.symbol, "decimals", t.decimals, dec.status === "success" ? dec.result : "ERR");
});

// ── Pools ───────────────────────────────────────────────
const poolResults = await client.multicall({
  allowFailure: true,
  blockNumber,
  contracts: POOLS.flatMap((p) => [
    { address: p.address, abi: pool, functionName: "token0" } as const,
    { address: p.address, abi: pool, functionName: "token1" } as const,
    { address: p.address, abi: pool, functionName: "fee" } as const,
    {
      address: CONTRACTS.uniswap.factory,
      abi: factoryAbi,
      functionName: "getPool",
      args: [TOKENS[p.token0].address, TOKENS[p.token1].address, p.fee],
    } as const,
  ]),
});
POOLS.forEach((p, i) => {
  const r = (k: number) => {
    const x = poolResults[i * 4 + k]!;
    return x.status === "success" ? String(x.result) : "ERR";
  };
  add("pool", p.name, "token0", TOKENS[p.token0].address, r(0));
  add("pool", p.name, "token1", TOKENS[p.token1].address, r(1));
  add("pool", p.name, "fee", p.fee, r(2));
  add("pool", p.name, "factory.getPool", p.address, r(3));
});

// ── Uniswap periphery ───────────────────────────────────
const peripheryResults = await client.multicall({
  allowFailure: true,
  blockNumber,
  contracts: [
    { address: CONTRACTS.uniswap.quoterV2, abi: periphery, functionName: "factory" },
    { address: CONTRACTS.uniswap.swapRouter02, abi: periphery, functionName: "factory" },
  ],
});
(["quoterV2", "swapRouter02"] as const).forEach((name, i) => {
  const x = peripheryResults[i]!;
  add("contract", `uniswap.${name}`, "factory()", CONTRACTS.uniswap.factory, x.status === "success" ? x.result : "ERR");
});

// ── Fee adapters ────────────────────────────────────────
const directory = await client.readContract({
  address: CONTRACTS.celo.registry,
  abi: registryAbi,
  functionName: "getAddressForStringOrDie",
  args: ["FeeCurrencyDirectory"],
  blockNumber,
});
add("contract", "celo.feeCurrencyDirectory", "registry lookup", CONTRACTS.celo.feeCurrencyDirectory, directory);
const listed = await client.readContract({ address: directory, abi: directoryAbi, functionName: "getCurrencies", blockNumber });
for (const [sym, adapter] of Object.entries(CONTRACTS.feeAdapters) as [keyof typeof CONTRACTS.feeAdapters, Address][]) {
  // Adapter versions differ: newer ones expose getAdaptedToken(), older ones adaptedToken().
  const [a, b] = await client.multicall({
    allowFailure: true,
    blockNumber,
    contracts: [
      { address: adapter, abi: adapterAbi, functionName: "getAdaptedToken" },
      { address: adapter, abi: adapterAbi, functionName: "adaptedToken" },
    ],
  });
  const wrapped = a?.status === "success" ? a.result : b?.status === "success" ? b.result : "ERR";
  add("feeAdapter", sym, "adapted token", TOKENS[sym].address, wrapped);
  add("feeAdapter", sym, "in FeeCurrencyDirectory", true, listed.some((l) => eq(l, adapter)));
  add("feeAdapter", sym, "token config points here", adapter, TOKENS[sym].feeCurrencyAdapter ?? "none");
}

// ── Code exists ─────────────────────────────────────────
const codeTargets: [string, Address][] = [
  ["uniswap.factory", CONTRACTS.uniswap.factory],
  ["uniswap.quoterV2", CONTRACTS.uniswap.quoterV2],
  ["uniswap.swapRouter02", CONTRACTS.uniswap.swapRouter02],
  ["textile.limitOrderReactor", CONTRACTS.textile.limitOrderReactor],
  ["textile.feeController", CONTRACTS.textile.feeController],
  ["textile.operatorVaultFactory", CONTRACTS.textile.operatorVaultFactory],
  ["textile.vaultOrderExecutor", CONTRACTS.textile.vaultOrderExecutor],
  ["permit2", CONTRACTS.permit2],
  ["erc8004.identity", CONTRACTS.erc8004.identity],
  ["erc8004.reputation", CONTRACTS.erc8004.reputation],
  ["selfAgentRegistry", CONTRACTS.selfAgentRegistry],
  ...(CONTRACTS.arbolitoReceipts ? ([["arbolitoReceipts", CONTRACTS.arbolitoReceipts]] as [string, Address][]) : []),
];
const codes = await Promise.all(codeTargets.map(([, a]) => client.getCode({ address: a, blockNumber })));
codeTargets.forEach(([name], i) => {
  const size = codes[i] ? (codes[i]!.length - 2) / 2 : 0;
  add("contract", name, "has code", "> 0 bytes", `${size} bytes`, size > 0);
});

// ── Report ──────────────────────────────────────────────
const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));
console.log(`Celo mainnet @ block ${blockNumber}\n`);
console.log(`${pad("", 3)}${pad("kind", 11)}${pad("name", 30)}${pad("check", 26)}actual`);
for (const r of rows) {
  console.log(`${r.ok ? "ok " : "XX "}${pad(r.kind, 11)}${pad(r.name, 30)}${pad(r.check, 26)}${r.actual}${r.ok ? "" : `   (expected ${r.expected})`}`);
}
const bad = rows.filter((r) => !r.ok);
console.log(`\n${rows.length - bad.length}/${rows.length} checks passed.`);
if (bad.length) {
  console.error(`${bad.length} mismatch(es). Fix packages/config or docs/04-reference.md before touching mainnet.`);
  process.exit(1);
}
