import { loadEnv } from "@arbolito/config";
import type { Quote, QuoteParams, VenueAdapter } from "../types";

/**
 * Textile v2 RFQ taker adapter (preview → firm quote).
 *
 * Gated: returns null unless TEXTILE_RFQ_ENABLED=true and TEXTILE_API_KEY is set.
 * The request/response shapes are deliberately NOT guessed. They get coded against
 * openapi-v2.json once docs.textilecredit.com is reachable and a tx_live_ key exists
 * (spike "Textile v2 taker flow" in docs/STATUS.md). Until then, enabling the flag
 * fails loudly instead of sending a made-up request.
 */
export class TextileRfqAdapter implements VenueAdapter {
  readonly venue = "textile_rfq" as const;

  get enabled(): boolean {
    const env = loadEnv();
    return env.TEXTILE_RFQ_ENABLED && !!env.TEXTILE_API_KEY;
  }

  async quote(_p: QuoteParams): Promise<Quote | null> {
    if (!this.enabled) return null;
    throw new Error(
      "Textile RFQ adapter is enabled but not implemented yet: waiting on openapi-v2.json (see the Textile v2 taker spike)",
    );
  }
}
