import { TransactionNotFoundError, TransactionReceiptNotFoundError, decodeEventLog, type Address, type Hex, type PublicClient } from "viem";
import { attributionCodes } from "@arbolito/chain";
import { receivedInTx } from "@arbolito/router";
import { bundleHash, routeIdToBytes32 } from "./hash";
import { receiptsAbi } from "./receipts";
import { proofBundleSchema, type ProofBundle } from "./schema";

export interface VerifyOptions {
  client: PublicClient;
  receipts: Address;
  /** If given, the anchoring emitter must be one of these. */
  emitters?: Address[];
}

export interface VerifyResult {
  ok: boolean;
  bundleHash?: Hex;
  anchor?: { txHash: Hex; blockNumber: bigint; emitter: Address };
  errors: string[];
}

/**
 * Independently verifies a published ProofBundle:
 * 1. JSON matches the v1 schema
 * 2. keccak256(canonical JSON) is anchored in ArbolitoReceipts (anchoredAt → ReceiptAnchored log)
 * 3. the log's routeId matches the bundle and the emitter is allowed
 * 4. the execution tx exists, succeeded, sits at the stated block, carries the stated attribution,
 *    and its Transfer logs delivered exactly execution.amountOut of tokenOut to the taker
 */
export async function verifyBundle(json: unknown, o: VerifyOptions): Promise<VerifyResult> {
  const errors: string[] = [];
  const parsed = proofBundleSchema.safeParse(json);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((i) => `schema: ${i.path.join(".")}: ${i.message}`) };
  const bundle: ProofBundle = parsed.data;
  const h = bundleHash(bundle);

  const at = await o.client.readContract({ address: o.receipts, abi: receiptsAbi, functionName: "anchoredAt", args: [h] });
  if (at === 0n) return { ok: false, bundleHash: h, errors: ["bundle hash is not anchored in ArbolitoReceipts"] };

  const logs = await o.client.getLogs({
    address: o.receipts,
    event: receiptsAbi.find((x) => x.type === "event" && x.name === "ReceiptAnchored")!,
    args: { bundleHash: h },
    fromBlock: at,
    toBlock: at,
  });
  const log = logs[0];
  if (!log) return { ok: false, bundleHash: h, errors: [`no ReceiptAnchored log at block ${at}`] };
  const ev = decodeEventLog({ abi: receiptsAbi, data: log.data, topics: log.topics });
  if (ev.eventName !== "ReceiptAnchored") return { ok: false, bundleHash: h, errors: ["unexpected event"] };
  const anchor = { txHash: log.transactionHash!, blockNumber: log.blockNumber!, emitter: ev.args.emitter };

  if (ev.args.routeId.toLowerCase() !== routeIdToBytes32(bundle.routeId).toLowerCase()) errors.push("routeId in log does not match bundle");
  if (o.emitters && !o.emitters.some((e) => e.toLowerCase() === ev.args.emitter.toLowerCase())) {
    errors.push(`emitter ${ev.args.emitter} is not an allowed Arbolito emitter`);
  }

  const execHash = bundle.execution.txHash as Hex;
  // A public RPC behind a load balancer sometimes has the tx but answers null for its receipt
  // (forno, 2026-10-25: about one lookup in three on week-old txs). That is the node, not the
  // receipt: ask again, and if it never agrees say "try again", never "mismatch".
  let [execReceipt, execTx] = await txAndReceipt(o.client, execHash);
  for (let i = 0; i < 4 && !execReceipt !== !execTx; i++) [execReceipt, execTx] = await txAndReceipt(o.client, execHash);
  if (!execReceipt !== !execTx) throw new Error(`the RPC returned the execution tx ${execHash} without its receipt; try again`);
  if (!execReceipt || !execTx) errors.push(`execution tx ${execHash} not found`);
  else {
    if (execReceipt.status !== "success") errors.push("execution tx reverted");
    if (execReceipt.blockNumber.toString() !== bundle.execution.blockNumber) errors.push("execution block number mismatch");
    if (execReceipt.blockNumber > anchor.blockNumber) errors.push("receipt was anchored before the execution");
    const codes = attributionCodes(execTx.input);
    if (codes.join(",") !== bundle.execution.attribution.join(",")) errors.push("execution attribution does not match bundle");
    // The claimed output must be what actually reached the receiver onchain: the taker on a
    // conversion, the recipient on a send (in the delivery transfer when the swap settled to the taker).
    const receiver = (bundle.request.recipient ?? bundle.request.taker) as Address;
    const deliveryHash = bundle.execution.deliveryTxHash as Hex | undefined;
    let deliveryReceipt = deliveryHash ? await o.client.getTransactionReceipt({ hash: deliveryHash }).catch(notFound) : execReceipt;
    for (let i = 0; i < 4 && !deliveryReceipt && deliveryHash; i++) {
      // Same flaky-node case: only call it missing if the tx itself is missing too.
      const [r, tx] = await txAndReceipt(o.client, deliveryHash);
      deliveryReceipt = r;
      if (!tx) break;
    }
    if (!deliveryReceipt && deliveryHash && (await o.client.getTransaction({ hash: deliveryHash }).catch(notFound))) {
      throw new Error(`the RPC returned the delivery tx ${deliveryHash} without its receipt; try again`);
    }
    if (!deliveryReceipt) errors.push(`delivery tx ${deliveryHash} not found`);
    else {
      if (deliveryReceipt.status !== "success") errors.push("delivery tx reverted");
      const delivered = receivedInTx(deliveryReceipt, bundle.request.tokenOut as Address, receiver);
      if (delivered.toString() !== bundle.execution.amountOut) {
        errors.push(`execution.amountOut ${bundle.execution.amountOut} does not match the ${delivered} delivered onchain`);
      }
    }
  }

  return { ok: errors.length === 0, bundleHash: h, anchor, errors };
}

/** The receipt and the tx in one go (each null when the node says "not found"). */
function txAndReceipt(client: PublicClient, hash: Hex) {
  return Promise.all([client.getTransactionReceipt({ hash }).catch(notFound), client.getTransaction({ hash }).catch(notFound)]);
}

/** "Not found" answers become null; any other RPC error is thrown, so callers show "unavailable", not a mismatch. */
function notFound(e: unknown): null {
  if (e instanceof TransactionNotFoundError || e instanceof TransactionReceiptNotFoundError) return null;
  throw e;
}
