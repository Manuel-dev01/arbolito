import { decodeEventLog, type Address, type Hex, type PublicClient } from "viem";
import { attributionCodes } from "@arbolito/chain";
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
 * 4. the execution tx exists, succeeded, sits at the stated block and carries the stated attribution
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
  const [execReceipt, execTx] = await Promise.all([
    o.client.getTransactionReceipt({ hash: execHash }).catch(() => null),
    o.client.getTransaction({ hash: execHash }).catch(() => null),
  ]);
  if (!execReceipt || !execTx) errors.push(`execution tx ${execHash} not found`);
  else {
    if (execReceipt.status !== "success") errors.push("execution tx reverted");
    if (execReceipt.blockNumber.toString() !== bundle.execution.blockNumber) errors.push("execution block number mismatch");
    if (execReceipt.blockNumber > anchor.blockNumber) errors.push("receipt was anchored before the execution");
    const codes = attributionCodes(execTx.input);
    if (codes.join(",") !== bundle.execution.attribution.join(",")) errors.push("execution attribution does not match bundle");
  }

  return { ok: errors.length === 0, bundleHash: h, anchor, errors };
}
