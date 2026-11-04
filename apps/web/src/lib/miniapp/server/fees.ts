import type { Address } from "viem";
import { TOKENS } from "@arbolito/config";
import { erc20Abi } from "@arbolito/router";
import { DOLLAR_FEE_RESERVE, type Sym } from "../contract";
import type { MiniappDeps } from "./deps";
import { ApiFailure } from "./errors";

/** MiniPay selects one dollar fee currency; CELO and wFIAT holdings do not satisfy this check. */
export async function networkFeeBalance(deps: MiniappDeps, account: Address): Promise<bigint> {
  const balances = await Promise.all((["USDT", "USDC", "USAT", "USDm"] as const).map(async (sym) => {
    const token = TOKENS[sym];
    const value = await deps.chain.readContract({ address: token.address, abi: erc20Abi, functionName: "balanceOf", args: [account] });
    return token.decimals === 18 ? value / 10n ** 12n : value;
  }));
  return balances.reduce((a, b) => a > b ? a : b, 0n);
}

/** MiniPay may choose the source dollar for gas, debited before the token transfer executes. */
export async function checkFeeReserve(deps: MiniappDeps, account: Address, sym: Sym, amount: bigint): Promise<void> {
  if (TOKENS[sym].kind !== "usd") {
    if (await networkFeeBalance(deps, account) < DOLLAR_FEE_RESERVE) {
      throw new ApiFailure("network_fee_required", "Add at least US$ 0.05 in MiniPay for network fees. Pesos, reais and CELO cannot cover the dollar fee MiniPay selects.", 422);
    }
    return;
  }
  const balance = await deps.chain.readContract({ address: TOKENS[sym].address, abi: erc20Abi, functionName: "balanceOf", args: [account] });
  if (amount + DOLLAR_FEE_RESERVE > balance) {
    throw new ApiFailure("fee_reserve", "Leave US$ 0.05 available for network fees. Try a smaller amount.", 422);
  }
}
