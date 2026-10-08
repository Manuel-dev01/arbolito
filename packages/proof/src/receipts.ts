import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseAbi, type Hex } from "viem";
import { findRepoRoot } from "@arbolito/config";

export const receiptsAbi = parseAbi([
  "constructor(address initialOwner)",
  "function owner() view returns (address)",
  "function isEmitter(address) view returns (bool)",
  "function anchoredAt(bytes32) view returns (uint256)",
  "function emitReceipt(bytes32 bundleHash, bytes32 routeId)",
  "function setEmitter(address emitter, bool allowed)",
  "event ReceiptAnchored(bytes32 indexed bundleHash, bytes32 indexed routeId, address indexed emitter)",
  "error NotEmitter()",
  "error AlreadyAnchored(bytes32 bundleHash)",
]);

/** Creation bytecode from `forge build` (contracts/out is gitignored; run `pnpm contracts:build`). */
export function receiptsBytecode(): Hex {
  const path = join(findRepoRoot(), "contracts", "out", "ArbolitoReceipts.sol", "ArbolitoReceipts.json");
  if (!existsSync(path)) throw new Error(`Missing ${path}. Run \`pnpm contracts:build\` first.`);
  const artifact = JSON.parse(readFileSync(path, "utf8")) as { bytecode: { object: Hex } };
  return artifact.bytecode.object;
}
