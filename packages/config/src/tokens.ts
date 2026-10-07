import type { Address } from "viem";

/**
 * Celo mainnet tokens. Source: docs/04-reference.md, verified by `pnpm verify:addresses`.
 * `onchainSymbol` is what `symbol()` returns; `symbol` is our canonical ticker.
 */
export interface TokenInfo {
  symbol: string;
  onchainSymbol: string;
  address: Address;
  decimals: number;
  /** Fee-abstraction adapter for 6-decimal fee currencies (pass this, not the token, as `feeCurrency`). */
  feeCurrencyAdapter?: Address;
  /** Whether the token is on Celo's fee-currency allowlist. */
  feeCurrency: boolean;
  kind: "wfiat" | "usd" | "mento" | "native" | "other";
}

export const TOKENS = {
  wARS: { symbol: "wARS", onchainSymbol: "wARS", address: "0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D", decimals: 18, feeCurrency: false, kind: "wfiat" },
  wBRL: { symbol: "wBRL", onchainSymbol: "wBRL", address: "0xD76f5Faf6888e24D9F04Bf92a0c8B921FE4390e0", decimals: 18, feeCurrency: false, kind: "wfiat" },
  wCOP: { symbol: "wCOP", onchainSymbol: "wCOP", address: "0x8a1D45e102e886510e891d2Ec656a708991e2D76", decimals: 18, feeCurrency: false, kind: "wfiat" },
  wMXN: { symbol: "wMXN", onchainSymbol: "wMXN", address: "0x337E7456B420bD3481e7FA61fA9850343d610d34", decimals: 18, feeCurrency: false, kind: "wfiat" },
  wPEN: { symbol: "wPEN", onchainSymbol: "wPEN", address: "0x4F34c8b3b5FB6D98Da888F0feA543d4d9C9F2eBE", decimals: 18, feeCurrency: false, kind: "wfiat" },
  wCLP: { symbol: "wCLP", onchainSymbol: "wCLP", address: "0x61D450a098b6a7f69fC4b98CE68198fe59768651", decimals: 18, feeCurrency: false, kind: "wfiat" },
  USAT: { symbol: "USAT", onchainSymbol: "USAT", address: "0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771", decimals: 6, feeCurrency: true, feeCurrencyAdapter: "0x0357EE22278c922e1D36cFe6b899269b161880C4", kind: "usd" },
  USDT: { symbol: "USDT", onchainSymbol: "USD₮", address: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e", decimals: 6, feeCurrency: true, feeCurrencyAdapter: "0x0E2A3e05bc9A16F5292A6170456A710cb89C6f72", kind: "usd" },
  USDC: { symbol: "USDC", onchainSymbol: "USDC", address: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C", decimals: 6, feeCurrency: true, feeCurrencyAdapter: "0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B", kind: "usd" },
  USDm: { symbol: "USDm", onchainSymbol: "USDm", address: "0x765DE816845861e75A25fCA122bb6898B8B1282a", decimals: 18, feeCurrency: true, kind: "mento" },
  BRLm: { symbol: "BRLm", onchainSymbol: "BRLm", address: "0xe8537a3d056DA446677B9E9d6c5dB704EaAb4787", decimals: 18, feeCurrency: true, kind: "mento" },
  COPm: { symbol: "COPm", onchainSymbol: "COPm", address: "0x8A567e2aE79CA692Bd748aB832081C45de4041eA", decimals: 18, feeCurrency: true, kind: "mento" },
  cNGN: { symbol: "cNGN", onchainSymbol: "cNGN", address: "0xF6829D7393dAe24509eb1E52eE8e572e2E271a4f", decimals: 6, feeCurrency: false, kind: "other" },
  CELO: { symbol: "CELO", onchainSymbol: "CELO", address: "0x471EcE3750Da237f93B8E339c536989b8978a438", decimals: 18, feeCurrency: false, kind: "native" },
} as const satisfies Record<string, TokenInfo>;

export type TokenSymbol = keyof typeof TOKENS;

const BY_ADDRESS = new Map<string, TokenInfo>(
  Object.values(TOKENS).map((t) => [t.address.toLowerCase(), t]),
);

/** Case-insensitive lookup. Accepts "wbrl", "USA₮", "usat", etc. */
export function tokenBySymbol(input: string): TokenInfo {
  const norm = input.trim().replace("₮", "T").toLowerCase();
  const hit = Object.values(TOKENS).find((t) => t.symbol.toLowerCase() === norm);
  if (!hit) throw new Error(`Unknown token "${input}". Known: ${Object.keys(TOKENS).join(", ")}`);
  return hit;
}

export function tokenByAddress(address: string): TokenInfo {
  const hit = BY_ADDRESS.get(address.toLowerCase());
  if (!hit) throw new Error(`Unknown token address ${address}`);
  return hit;
}
