import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { advantagePct, parseWesternUnion, plausible, readWesternUnion, type BrowserSession } from "../src";

const fixture = (f: string) => readFileSync(join(__dirname, "fixtures", f), "utf8");

describe("Western Union's converter, read from buy's browser snapshots (captured 2026-10-20)", () => {
  it("reads the amount sent and received, and the rate", () => {
    expect(parseWesternUnion(fixture("wu-usd-brl.txt"), "USD-BRL")).toMatchObject({ sendAmount: 700, receiveAmount: 3375.89, rate: 3375.89 / 700 });
    expect(parseWesternUnion(fixture("wu-usd-ars.txt"), "USD-ARS")).toMatchObject({ sendAmount: 500, receiveAmount: 809_375, rate: 1618.75 });
  });

  it("returns nothing when the page hasn't computed the amount, or the layout changed", () => {
    expect(parseWesternUnion(fixture("wu-usd-brl-unloaded.txt"), "USD-BRL")).toBeNull();
    expect(parseWesternUnion("- heading \"Something else\"", "USD-ARS")).toBeNull();
  });

  it("discards implausible readings and computes our advantage", () => {
    expect(plausible(4.82, 5.06)).toBe(true);
    expect(plausible(48.2, 5.06)).toBe(false);
    expect(advantagePct(5.06, 4.8227)).toBe(4.92);
  });

  it("drives a session: open, wait, snapshot; never leaks the token in errors", async () => {
    const session: BrowserSession = { sessionId: "s", accessToken: "SECRET-TOKEN-0123456789", status: "ready", expiresAt: "", commandUrl: "https://gw.test/v1/browser/sessions/s/commands" };
    const seen: string[] = [];
    const f = async (_u: string, init?: RequestInit) => {
      const body = JSON.parse(String(init!.body)) as { action: string; url?: string };
      seen.push(body.action);
      if (body.url?.includes("usd-to-ars")) return new Response(`denied for SECRET-TOKEN-0123456789`, { status: 502 });
      const data = body.action === "snapshot" ? { snapshot: fixture("wu-usd-brl.txt") } : {};
      return new Response(JSON.stringify({ output: { success: true, data } }), { status: 200 });
    };
    const r = await readWesternUnion(session, ["USD-BRL", "USD-ARS"], f, 0);
    expect(r.rates.map((x) => x.corridor)).toEqual(["USD-BRL"]);
    expect(r.errors[0]).toContain("USD-ARS");
    expect(r.errors[0]).not.toContain("SECRET-TOKEN");
    expect(seen.slice(0, 3)).toEqual(["open", "wait", "snapshot"]);
  });
});

describe("browser commands", () => {
  it("resend a command that never reached the (already paid) session, but not an HTTP error", async () => {
    const { command } = await import("../src");
    const session: BrowserSession = { sessionId: "s", accessToken: "SECRET-TOKEN-0123456789", status: "ready", expiresAt: "", commandUrl: "https://gw.test/c" };
    let n = 0;
    const flaky = async () => {
      if (n++ < 2) throw new TypeError("fetch failed");
      return new Response(JSON.stringify({ output: { success: true, data: { ok: 1 } } }));
    };
    expect(await command(session, { action: "snapshot" }, flaky, 3)).toEqual({ ok: 1 });
    let m = 0;
    const http = async () => (m++, new Response("nope", { status: 400 }));
    await expect(command(session, { action: "open" }, http, 3)).rejects.toThrow(/400/);
    expect(m).toBe(1);
  });
});
