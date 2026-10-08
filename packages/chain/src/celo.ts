import { defineChain } from "viem";
import { chainConfig } from "viem/celo";
import { CELO_MAINNET_ID, EXPLORER_URL } from "@arbolito/config";

/**
 * Celo mainnet, equivalent to `celo` from viem/chains. Defined here because importing
 * viem/chains loads every chain definition (~6s on Windows), which blew the 4s quote budget.
 * chainConfig carries Celo's formatters and CIP-64 (feeCurrency) serializer.
 */
export const celoMainnet = defineChain({
  ...chainConfig,
  id: CELO_MAINNET_ID,
  name: "Celo",
  nativeCurrency: { decimals: 18, name: "CELO", symbol: "CELO" },
  rpcUrls: { default: { http: ["https://forno.celo.org"] } },
  blockExplorers: { default: { name: "Celoscan", url: EXPLORER_URL } },
  contracts: {
    // Verified onchain 2026-10-08 (3808 bytes of code).
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11", blockCreated: 13112599 },
  },
  testnet: false,
});
