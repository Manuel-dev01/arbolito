import type { Metadata } from "next";
import { withAttribution } from "@arbolito/chain";
import { CONTRACTS } from "@arbolito/config";
import { MiniPayCheck } from "./check";

/**
 * Founder-only diagnostics, opened inside MiniPay (Developer Mode) to settle four unknowns before
 * the Mini App relies on them: auto-connect, personal_sign, eth_signTypedData_v4, and whether a
 * MiniPay-sent tx keeps the ERC-8021 suffix and the requested feeCurrency.
 */
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "MiniPay check", robots: { index: false, follow: false } };

const CODE_RE = /^[a-z0-9_]{1,32}$/;

export default function Page() {
  // The attribution code is public by design (it is in every tagged tx's calldata).
  const code = process.env.ATTRIBUTION_CODE && CODE_RE.test(process.env.ATTRIBUTION_CODE) ? process.env.ATTRIBUTION_CODE : null;
  const suffix = code ? withAttribution(undefined, code) : null;
  return <MiniPayCheck code={code} suffix={suffix} usdtAdapter={CONTRACTS.feeAdapters.USDT} />;
}
