/**
 * Checks an x402 v2 seller end to end without moving money: reads the free 402, signs a payment
 * for the chosen asset with a throwaway key (never funded) and asks Celo's facilitator to /verify
 * it. Nothing is settled. A good seller and payload come back "insufficient funds" (or valid).
 *
 *   pnpm x402:check <url> [asset symbol, default wBRL] [--e2e]
 *
 * --e2e signs with the local e2e wallet instead, so a funded payer gets a full yes from /verify.
 * Still free: /verify never settles, and the payload goes only to the facilitator.
 * --amount <atomic> checks a smaller amount than the 402 asks (a payer short of the price).
 */
import { createPublicClient, http } from "viem";
import { celo } from "viem/chains";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { loadEnv, tokenBySymbol } from "@arbolito/config";
import { quoteV2, signV2, verifyV2 } from "@arbolito/x402";
import type { Hex } from "viem";
import { flagValue, hasFlag, positional } from "./lib/cli";

const [url, sym = "wBRL"] = positional();
if (!url) throw new Error("usage: pnpm x402:check <url> [asset symbol]");
const env = loadEnv();
const token = tokenBySymbol(sym);
const quote = await quoteV2(url, token.address);
const override = flagValue("amount");
if (override) {
  quote.requirement = { ...quote.requirement, amount: override };
  quote.paymentRequired = { ...quote.paymentRequired, accepts: quote.paymentRequired.accepts.map((r) => (r.asset === quote.requirement.asset ? quote.requirement : r)) };
  quote.amount = BigInt(override);
}
console.log(`402 asks ${quote.amount} (${token.decimals} dp) ${token.symbol} to ${quote.requirement.payTo}; extensions: ${Object.keys(quote.paymentRequired.extensions ?? {}).join(", ") || "none"}`);
const e2eKey = env.E2E_PRIVATE_KEY;
if (hasFlag("e2e") && !e2eKey) throw new Error("E2E_PRIVATE_KEY is not set");
const account = privateKeyToAccount(hasFlag("e2e") ? (e2eKey as Hex) : generatePrivateKey());
const publicClient = createPublicClient({ chain: celo, transport: http(env.CELO_RPC_URL) });
const payload = await signV2({ account, publicClient: publicClient as never, quote, builderCode: env.ATTRIBUTION_CODE });
console.log(`signed by ${hasFlag("e2e") ? "e2e wallet" : "throwaway"} ${account.address}; payload extensions: ${Object.keys(payload.extensions ?? {}).join(", ") || "none"}`);
const result = await verifyV2(env.X402_FACILITATOR_URL, payload, quote.requirement);
console.log(`facilitator /verify: ${JSON.stringify(result)}`);
