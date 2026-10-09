import { parseAbi } from "viem";

/**
 * The read-only slice of ArbolitoReceipts the browser needs. Client-safe copy of the entries in
 * packages/proof's receiptsAbi (that module reads build artifacts from disk, so it stays server-side);
 * a unit test keeps the two in sync.
 */
export const receiptsReadAbi = parseAbi([
  "function anchoredAt(bytes32) view returns (uint256)",
  "function isEmitter(address) view returns (bool)",
  "event ReceiptAnchored(bytes32 indexed bundleHash, bytes32 indexed routeId, address indexed emitter)",
]);

export const EXPLORER = "https://celoscan.io";
export const txUrl = (hash: string) => `${EXPLORER}/tx/${hash}`;
export const addressUrl = (addr: string) => `${EXPLORER}/address/${addr}`;
export const blockUrl = (block: string | bigint) => `${EXPLORER}/block/${block}`;
