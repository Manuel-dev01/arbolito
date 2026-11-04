/**
 * Maps backend error codes (contract ApiErrorCode) and client-side failures to what the UI does.
 * None of these states means money moved: the server never moves money, and every one of them
 * happens before the wallet sends anything.
 */
import type { ApiErrorCode } from "../contract";

export type ClientErrorCode = ApiErrorCode | "network" | "bad_response";

export type UiErrorState =
  /** Show "Ahora no hay mercado para A → B". */
  | { kind: "no-market" }
  /** Dim the card: "Esta cotización venció" → "Pedir nueva cotización". */
  | { kind: "expired" }
  /** Re-quote and show "El precio cambió" with the new amount. */
  | { kind: "price-changed" }
  /** Sign the one-time taker proof in MiniPay, then call /prepare again. */
  | { kind: "needs-proof" }
  /** A toast; stay on the current screen. `retry` says whether trying again can help. */
  | { kind: "toast"; message: "notReady" | "rateLimited" | "fundsReserved" | "feeReserve" | "networkFee" | "upstream" | "offline" | "minimum" | "generic"; retry: boolean };

export function mapApiError(code: ClientErrorCode): UiErrorState {
  switch (code) {
    case "no_route":
    case "via_dollars":
      return { kind: "no-market" };
    case "quote_expired":
      return { kind: "expired" };
    case "price_changed":
      return { kind: "price-changed" };
    case "needs_taker_proof":
      return { kind: "needs-proof" };
    case "not_ready":
      return { kind: "toast", message: "notReady", retry: false };
    case "below_minimum":
      return { kind: "toast", message: "minimum", retry: false };
    case "rate_limited":
      return { kind: "toast", message: "rateLimited", retry: true };
    case "funds_reserved":
      return { kind: "toast", message: "fundsReserved", retry: true };
    case "fee_reserve":
      return { kind: "toast", message: "feeReserve", retry: false };
    case "network_fee_required":
      return { kind: "toast", message: "networkFee", retry: false };
    case "upstream":
      return { kind: "toast", message: "upstream", retry: true };
    case "network":
      return { kind: "toast", message: "offline", retry: true };
    case "bad_request":
    case "bad_response":
    default:
      return { kind: "toast", message: "generic", retry: false };
  }
}
