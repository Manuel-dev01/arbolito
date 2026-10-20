/**
 * Driving a browser session bought from buy (POST /v1/browser/sessions): the paid response holds
 * a bearer `accessToken` and a `commandUrl`; commands are agent-browser actions (open, wait,
 * snapshot, …). The token and URLs are bearer capabilities: never logged.
 */
import { z } from "zod";
import { WESTERN_UNION_PAGES, parseWesternUnion, type CompetitorRate, type Corridor } from "./index";

export const BrowserSession = z.object({
  sessionId: z.string(),
  accessToken: z.string().min(16),
  status: z.string(),
  expiresAt: z.string(),
  commandUrl: z.string().url(),
});
export type BrowserSession = z.infer<typeof BrowserSession>;

/** The browser part of buy's paid response. */
export const PaidBrowserResponse = z.object({ browser: BrowserSession }).passthrough();

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export class BrowserCommandError extends Error {}

/** One command; returns `output.data`. Never includes the token in an error. */
export async function command(s: BrowserSession, body: Record<string, unknown>, f: FetchLike = fetch, retries = 3): Promise<Record<string, unknown>> {
  // The session is already paid for, so a command that never reached it (network error) is
  // safe to resend. HTTP errors are answers and are not retried.
  let res: Response | undefined;
  for (let i = 0; !res; i++) {
    try {
      res = await f(s.commandUrl, {
        method: "POST",
        headers: { authorization: `Bearer ${s.accessToken}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (e) {
      if (i >= retries) throw new BrowserCommandError(`${String(body.action)}: ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, 1_000 * (i + 1)));
    }
  }
  const text = await res.text();
  if (!res.ok) throw new BrowserCommandError(`${String(body.action)} → ${res.status} ${text.split(s.accessToken).join("<token>").slice(0, 200)}`);
  const json = JSON.parse(text) as { output?: { data?: Record<string, unknown>; success?: boolean; error?: string | null } };
  if (json.output?.success === false) throw new BrowserCommandError(`${String(body.action)} failed: ${json.output.error ?? "unknown"}`);
  return json.output?.data ?? {};
}

/**
 * Western Union's rate for each corridor in one session: open the converter, give it a few
 * seconds to compute, read the snapshot. A corridor that fails is skipped, not fatal.
 */
export async function readWesternUnion(s: BrowserSession, corridors: readonly Corridor[], f: FetchLike = fetch, waitMs = 3_000): Promise<{ rates: CompetitorRate[]; errors: string[] }> {
  const rates: CompetitorRate[] = [];
  const errors: string[] = [];
  for (const c of corridors) {
    try {
      await command(s, { action: "open", url: WESTERN_UNION_PAGES[c] }, f);
      await command(s, { action: "wait", target: String(waitMs) }, f);
      let rate: CompetitorRate | null = null;
      // The amount can lag the page load; one more look after a second wait.
      for (let i = 0; i < 2 && !rate; i++) {
        if (i) await command(s, { action: "wait", target: String(waitMs) }, f);
        rate = parseWesternUnion(String((await command(s, { action: "snapshot" }, f)).snapshot ?? ""), c);
      }
      if (rate) rates.push(rate);
      else errors.push(`${c}: the converter showed no amount`);
    } catch (e) {
      errors.push(`${c}: ${(e as Error).message}`);
    }
  }
  return { rates, errors };
}
