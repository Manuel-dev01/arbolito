/**
 * Ripio ramp deep links (no credentials). From the Ripio team via the hackathon channel:
 * on-ramp https://ramp.ripio.com/, off-ramp https://ramp.ripio.com/offramp; params country,
 * chain, token, amount, address. With country+chain+token+amount the user skips the form.
 * Ripio runs end-user KYC inside its flow. See docs/04-reference.md "Ripio ramps".
 */
import { CELO_MAINNET_ID } from "@arbolito/config";

const RAMP = "https://ramp.ripio.com";

/** Country whose local currency the token represents. USD stables default to Argentina. */
const COUNTRY: Record<string, "AR" | "BR"> = { wARS: "AR", wBRL: "BR" };
/** Ripio's token tickers. */
const TICKER: Record<string, string> = { wARS: "WARS", wBRL: "WBRL", USDT: "USDT", USDC: "USDC", USAT: "USAT" };

export interface RampLinkParams {
  direction: "on" | "off";
  token: string;
  address: string;
  /** Human amount (e.g. "10000"); omitted to let the user choose. */
  amount?: string;
  country?: "AR" | "BR" | "MX" | "CO";
}

export function rampLink(p: RampLinkParams): string {
  const ticker = TICKER[p.token];
  if (!ticker) throw new Error(`Ripio ramp doesn't support ${p.token}`);
  if (!/^0x[0-9a-fA-F]{40}$/.test(p.address)) throw new Error("ramp address must be a 0x address");
  if (p.amount !== undefined && !/^\d+(\.\d+)?$/.test(p.amount)) throw new Error("ramp amount must be a positive decimal");
  const q = new URLSearchParams({
    country: p.country ?? COUNTRY[p.token] ?? "AR",
    chain: String(CELO_MAINNET_ID),
    token: ticker,
    address: p.address,
  });
  if (p.amount) q.set("amount", p.amount);
  return `${RAMP}${p.direction === "off" ? "/offramp" : "/"}?${q.toString()}`;
}
