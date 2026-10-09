import { CELO_MAINNET_ID, loadEnv } from "@arbolito/config";
import type { Quote, QuoteParams, VenueAdapter } from "../types";
import { TextileApiError, TextileClient } from "./api";

/**
 * Textile v2 RFQ venue.
 * quote(): the free /rfq/preview (indicative, reserves nothing, no key needed), so Textile
 * always competes in routing. Firm quotes are taken only at execution time (see
 * textileFirmEnabled), because /rfq/request locks real maker inventory.
 */
export class TextileRfqAdapter implements VenueAdapter {
  readonly venue = "textile_rfq" as const;
  constructor(
    private readonly client = new TextileClient(),
    private readonly chainId = CELO_MAINNET_ID,
  ) {}

  async quote(p: QuoteParams): Promise<Quote | null> {
    let preview;
    try {
      preview = await this.client.preview({ chainId: this.chainId, sellToken: p.tokenIn, buyToken: p.tokenOut, sellAmount: p.amountIn });
    } catch (err) {
      // No corridor for this pair (e.g. wBRL→wARS direct) is a normal "can't quote", not a venue error.
      if (err instanceof TextileApiError && err.body.includes("corridor_unavailable")) return null;
      throw err;
    }
    if (preview.status !== "preview" || !preview.buyAmount || preview.buyAmount === "0") return null;
    // Preview may price less than requested when depth is thin; only a full fill is a valid leg.
    if (preview.sellAmount && BigInt(preview.sellAmount) < p.amountIn) return null;
    return {
      venue: this.venue,
      tokenIn: p.tokenIn,
      tokenOut: p.tokenOut,
      amountIn: p.amountIn,
      amountOut: BigInt(preview.buyAmount),
      blockNumber: p.blockNumber,
      firm: false,
      raw: { kind: "preview", ...preview },
    };
  }
}

/** Firm Textile quotes and Textile-leg execution are opt-in until a funded taker exercises them on mainnet. */
export const textileFirmEnabled = () => loadEnv().TEXTILE_RFQ_ENABLED;
