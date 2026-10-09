import { parseEventLogs, type Address, type TransactionReceipt } from "viem";
import { erc20Abi } from "./abis";

/**
 * Amount of `token` delivered to `recipient` by one transaction, summed from its Transfer logs.
 * This is the authoritative executed amount: balance diffs read over a load-balanced RPC can
 * hit a node that hasn't seen the tx yet (it happened on forno, recording 0 for a real swap).
 */
export function receivedInTx(receipt: Pick<TransactionReceipt, "logs">, token: Address, recipient: Address): bigint {
  return parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: receipt.logs })
    .filter((l) => l.address.toLowerCase() === token.toLowerCase() && l.args.to.toLowerCase() === recipient.toLowerCase())
    .reduce((sum, l) => sum + l.args.value, 0n);
}
