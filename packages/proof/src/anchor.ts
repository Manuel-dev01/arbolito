import { encodeFunctionData, type Address, type Hex, type PublicClient, type WalletClient } from "viem";
import { sendGuarded, type GuardedSendParams } from "@arbolito/chain";
import { bundleHash, routeIdToBytes32 } from "./hash";
import { receiptsAbi } from "./receipts";
import type { ProofBundle } from "./schema";

export interface AnchorArgs {
  bundle: ProofBundle;
  receipts: Address;
  mode: GuardedSendParams["mode"];
  live?: boolean;
  publicClient: PublicClient;
  walletClient: WalletClient;
  feeCurrency?: string;
  /** Spend ledger for the anchoring wallet (defaults to sendGuarded's; serverless hosts pass a DB ledger). */
  ledger?: GuardedSendParams["ledger"];
}

export interface AnchorResult {
  bundleHash: Hex;
  routeIdBytes32: Hex;
  txHash: Hex;
  blockNumber: bigint;
}

/** Emits ArbolitoReceipts.emitReceipt(bundleHash, routeId) through the guarded sender (gas only, $0 value). */
export async function anchorBundle(a: AnchorArgs): Promise<AnchorResult> {
  const h = bundleHash(a.bundle);
  const rid = routeIdToBytes32(a.bundle.routeId);
  const { hash, receipt } = await sendGuarded({
    mode: a.mode,
    live: a.live,
    publicClient: a.publicClient,
    walletClient: a.walletClient,
    to: a.receipts,
    data: encodeFunctionData({ abi: receiptsAbi, functionName: "emitReceipt", args: [h, rid] }),
    usdMicros: 0n,
    purpose: `anchor receipt ${a.bundle.routeId}`,
    feeCurrency: a.feeCurrency,
    ledger: a.ledger,
  });
  return { bundleHash: h, routeIdBytes32: rid, txHash: hash, blockNumber: receipt.blockNumber };
}
