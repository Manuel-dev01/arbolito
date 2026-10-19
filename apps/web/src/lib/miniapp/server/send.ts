import { encodeFunctionData, erc20Abi, type Address } from "viem";
import type { z } from "zod";
import { TOKENS } from "@arbolito/config";
import type { SendPrepareRequest, SendPrepareResponse } from "../contract";
import type { MiniappDeps } from "./deps";
import { badRequest } from "./errors";
import { loadLiveQuote, prepareQuote, publicCalls, tagged } from "./prepare";
import { parseAmount } from "./quote";

/**
 * POST /send/prepare: send to a contact.
 * - Same currency: one tagged ERC-20 transfer to the contact; nothing to quote or submit.
 * - Cross currency: the account's live quote for exactly this pair and amount is prepared with the
 *   contact as recipient (Uniswap pays them in the swap; a Textile fill is forwarded exactly).
 *   The client submits it through /submit like a conversion, and the receipt names the recipient.
 */
export async function prepareSend(deps: MiniappDeps, req: z.infer<typeof SendPrepareRequest>): Promise<z.infer<typeof SendPrepareResponse>> {
  const account = req.account.toLowerCase() as Address;
  const recipient = req.recipient.toLowerCase() as Address;
  if (recipient === account) throw badRequest("Pick a contact other than your own wallet.");
  if (/^0x0{40}$/.test(recipient)) throw badRequest("That contact has no wallet address.");
  const amountIn = parseAmount(req.from, req.amount);

  if (req.from === req.to) {
    const data = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [recipient, amountIn] });
    const call = tagged(deps, { to: TOKENS[req.from].address as Address, data, value: 0n, label: "send to contact" });
    return { calls: publicCalls([call]), expectedOut: amountIn.toString(), minOut: amountIn.toString() };
  }

  if (!req.quoteId) throw badRequest("A send that changes currency needs a quote first.");
  const row = await loadLiveQuote(deps, deps.store(), req.quoteId, account);
  // The quote must be for exactly this send: never prepare a different pair or size than shown.
  if (row.fromSym !== req.from || row.toSym !== req.to || BigInt(row.amountIn) !== amountIn) {
    throw badRequest("The quote doesn't match this send; ask for a new one.", 409);
  }
  const p = await prepareQuote(deps, { quoteId: req.quoteId, account }, { recipient });
  return { calls: p.calls, expectedOut: p.expectedOut, minOut: p.minOut, quoteId: p.quoteId };
}
