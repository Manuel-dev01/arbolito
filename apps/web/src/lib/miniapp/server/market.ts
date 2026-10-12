import type { Address } from "viem";
import type { z } from "zod";
import { TOKENS } from "@arbolito/config";
import { erc20Abi, usdMicros } from "@arbolito/router";
import { SYMBOLS, type BalancesResponse, type RatesResponse, type Sym } from "../contract";
import type { MiniappDeps } from "./deps";
import { upstream } from "./errors";
import { logError } from "./http";

/** GET /rates: reference rates (dolarapi, Uniswap mids, Textile tickers), cached ~30 s in deps. */
export async function getRates(deps: MiniappDeps): Promise<z.infer<typeof RatesResponse>> {
  const blockNumber = await deps.chain.getBlockNumber();
  const { references } = await deps.references(blockNumber);
  return { at: new Date(deps.now()).toISOString(), references: references.map(({ name, pair, rate, source, at }) => ({ name, pair, rate, source, at })) };
}

export interface RawBalance {
  sym: Sym;
  amount: bigint;
  usdMicros: bigint;
}

/** Balances of the 5 Mini App tokens at one block, plus approximate USD values (micro-USD). */
export async function readBalances(deps: MiniappDeps, account: Address): Promise<{ blockNumber: bigint; balances: RawBalance[] }> {
  const blockNumber = await deps.chain.getBlockNumber();
  let amounts: bigint[];
  try {
    amounts = (await deps.chain.multicall({
      allowFailure: false,
      blockNumber,
      contracts: SYMBOLS.map((s) => ({ address: TOKENS[s].address, abi: erc20Abi, functionName: "balanceOf", args: [account] }) as const),
    })) as bigint[];
  } catch (err) {
    logError("balances multicall", err);
    throw upstream("Could not read balances from the network. Try again.");
  }
  const balances = await Promise.all(
    SYMBOLS.map(async (sym, i) => {
      const amount = amounts[i] ?? 0n;
      let usd = 0n;
      if (amount > 0n) {
        try {
          usd = await usdMicros(deps.chain, TOKENS[sym].address, amount, blockNumber);
        } catch (err) {
          // Display-only value; a pool that can't price the whole balance shows 0 rather than failing.
          logError(`balances usd ${sym}`, err);
        }
      }
      return { sym, amount, usdMicros: usd };
    }),
  );
  return { blockNumber, balances };
}

/** GET /balances?account= */
export async function getBalances(deps: MiniappDeps, account: Address): Promise<z.infer<typeof BalancesResponse>> {
  const { blockNumber, balances } = await readBalances(deps, account);
  return {
    account,
    balances: balances.map((b) => ({ sym: b.sym, amount: b.amount.toString(), decimals: TOKENS[b.sym].decimals })),
    usdMicros: Object.fromEntries(balances.map((b) => [b.sym, b.usdMicros.toString()])) as Record<Sym, string>,
    blockNumber: blockNumber.toString(),
  };
}
