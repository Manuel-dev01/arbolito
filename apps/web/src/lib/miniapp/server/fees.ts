import type { Address } from "viem";
import { TOKENS } from "@arbolito/config";
import { erc20Abi } from "@arbolito/router";
import { DOLLAR_FEE_RESERVE, type Sym } from "../contract";
import type { MiniappDeps } from "./deps";
import { ApiFailure } from "./errors";

/** MiniPay may choose the source dollar for gas, debited before the token transfer executes. */
export async function checkFeeReserve(deps: MiniappDeps, account: Address, sym: Sym, amount: bigint): Promise<void> {
  if (TOKENS[sym].kind !== "usd") return;
  const balance = await deps.chain.readContract({ address: TOKENS[sym].address, abi: erc20Abi, functionName: "balanceOf", args: [account] });
  if (amount + DOLLAR_FEE_RESERVE > balance) {
    throw new ApiFailure("fee_reserve", "Leave US$ 0.05 available for network fees. Try a smaller amount.", 422);
  }
}
