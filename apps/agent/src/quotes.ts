import { zeroAddress, type Address } from "viem";
import { tokenBySymbol } from "@arbolito/config";
import { executableRoutes, plan, textileFirmEnabled, toAtomic, type Reference, type Route } from "@arbolito/router";
import type { Services } from "./services";

export interface QuoteResult {
  /** Best route that can execute today (all-Uniswap until firm Textile execution is enabled). */
  route: Route;
  /** Every other route considered, best first, including ones that can't execute yet. */
  alternatives: Route[];
  references: Reference[];
  blockNumber: bigint;
}

export class NoRouteError extends Error {
  constructor() {
    super("no route");
    this.name = "NoRouteError";
  }
}

/** Quote `amount` (human decimal string) of `from` into `to`. Throws NoRouteError when nothing can execute. */
export async function quote(s: Services, from: string, to: string, amount: string, taker?: string | null): Promise<QuoteResult> {
  const tin = tokenBySymbol(from);
  const tout = tokenBySymbol(to);
  const amountIn = toAtomic(tin.address, amount);
  const blockNumber = await s.chain.getBlockNumber();
  const [planned, refs] = await Promise.all([
    plan({
      client: s.chain,
      adapters: s.adapters,
      tokenIn: tin.address,
      tokenOut: tout.address,
      amountIn,
      taker: (taker ?? zeroAddress) as Address,
      blockNumber,
    }),
    s.references(blockNumber),
  ]);
  const executable = executableRoutes(planned, { textileFirm: textileFirmEnabled() });
  const route = executable[0];
  if (!route) throw new NoRouteError();
  const all = planned.best ? [planned.best, ...planned.alternatives] : [];
  return { route, alternatives: all.filter((r) => r.id !== route.id), references: refs.references, blockNumber };
}
