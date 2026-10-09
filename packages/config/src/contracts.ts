import type { Address } from "viem";

/**
 * Celo mainnet contracts. Source: docs/04-reference.md. Every entry is checked by
 * `pnpm verify:addresses` (code exists; periphery reports the expected factory).
 */
export const CONTRACTS = {
  uniswap: {
    factory: "0xAfE208a311B21f13EF87E33A90049fC17A7acDEc",
    /** Verified onchain 2026-10-07: factory() matches; struct-arg quoteExactInputSingle. */
    quoterV2: "0x82825d0554fA07f7FC52Ab63c961F330fdEFa8E8",
    /** Verified onchain 2026-10-07: factory() matches. */
    swapRouter02: "0x5615CDAb10dc425a742d643d949a7F474C01abc4",
  },
  textile: {
    limitOrderReactor: "0xa9AA0a64769cBed4d3B1Ceb4Df01CdE915C235b3",
    feeController: "0x7b005466F905DD882A959888154587fA76cd3Ea7",
    operatorVaultFactory: "0x88104decA449C797632AfdcA77A3140b24cD844A",
    vaultOrderExecutor: "0x01b006d5c687bde182aa36F542f1f014144742e2",
  },
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  celo: {
    /** Core registry; resolves FeeCurrencyDirectory etc. */
    registry: "0x000000000000000000000000000000000000ce10",
    /** Resolved from the registry 2026-10-07. */
    feeCurrencyDirectory: "0x15F344b9E6c3Cb6F0376A36A64928b13F62C6276",
  },
  /** Fee-abstraction adapters for 6-decimal tokens (listed in FeeCurrencyDirectory 2026-10-07). */
  feeAdapters: {
    USAT: "0x0357EE22278c922e1D36cFe6b899269b161880C4",
    USDT: "0x0E2A3e05bc9A16F5292A6170456A710cb89C6f72",
    USDC: "0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B",
  },
  erc8004: {
    identity: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
    reputation: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63",
  },
  selfAgentRegistry: "0xaC3DF9ABf80d0F5c020C06B04Cced27763355944",
  x402: {
    facilitatorSigner: "0x0d74D5Cefd2e7F24E623330ebE3d8D4cB45fFB48",
    buyPayTo: "0x20faAca5F980E29639A0FCC6dcA6988E18ed333B",
  },
  /** Deployed 2026-10-09, tx 0xd3e1a5f6…a421a, block 79641781; owner/emitter = ops wallet. Fork tests deploy their own. */
  arbolitoReceipts: "0x5C0b1208D81e0a44DEd74C7e01C54e8ee6b62d34" as Address | undefined,
} as const;
