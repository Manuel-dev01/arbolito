import { describe, expect, it, vi } from "vitest";
import { MiniAppApiError, createMiniAppClient, quoteErrorCopy } from "../src/api";
import { quote } from "./fixtures";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("Mini App quote client", () => {
  it("POSTs the contract's QuoteRequest to PUBLIC_BASE_URL and zod-parses the response", async () => {
    const fetchFn = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => json(200, quote));
    const client = createMiniAppClient({ baseUrl: "https://web.example/", fetchFn: fetchFn as typeof fetch });
    const q = await client.quote({ from: "USDT", to: "wARS", amount: "100", lang: "es", account: "0x7e0316b2533F6dF2E651295A9B11481BB8346c3c" });
    expect(q).toEqual(quote);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("https://web.example/api/miniapp/quote");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(String(init?.body))).toEqual({ from: "USDT", to: "wARS", amount: "100", lang: "es", account: "0x7e0316b2533F6dF2E651295A9B11481BB8346c3c" });
  });

  it("rejects a bad request before sending it", async () => {
    const fetchFn = vi.fn();
    const client = createMiniAppClient({ baseUrl: "https://web.example", fetchFn: fetchFn as typeof fetch });
    await expect(client.quote({ from: "USDT", to: "wARS", amount: "1e9" })).rejects.toMatchObject({ code: "bad_request" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("maps contract error codes, and only those, from error bodies", async () => {
    const cases: [number, unknown, string][] = [
      [422, { error: { code: "no_route", message: "no market" } }, "no_route"],
      [429, { error: { code: "rate_limited", message: "slow down" } }, "rate_limited"],
      [400, { error: { code: "bad_request", message: "amount" } }, "bad_request"],
      [503, { error: { code: "upstream", message: "rpc" } }, "upstream"],
      [429, { nope: true }, "rate_limited"],
      [500, { error: { code: "made_up", message: "x" } }, "upstream"],
    ];
    for (const [status, body, code] of cases) {
      const client = createMiniAppClient({ baseUrl: "https://web.example", fetchFn: (async () => json(status, body)) as typeof fetch });
      const err = await client.quote({ from: "wBRL", to: "wARS", amount: "200" }).catch((e) => e);
      expect(err).toBeInstanceOf(MiniAppApiError);
      expect(err.code).toBe(code);
      expect(err.status).toBe(status);
    }
  });

  it("treats network failures, non-JSON and off-contract 200s as upstream errors", async () => {
    const bodies = [
      async () => {
        throw new TypeError("fetch failed");
      },
      async () => new Response("<html>oops</html>", { status: 200 }),
      async () => json(200, { ...quote, amountIn: "1.5" }),
      async () => json(200, { ...quote, quoteId: "nope" }),
    ];
    for (const fetchFn of bodies) {
      const client = createMiniAppClient({ baseUrl: "https://web.example", fetchFn: fetchFn as typeof fetch });
      const err = await client.quote({ from: "wBRL", to: "wARS", amount: "200" }).catch((e) => e);
      expect(err).toBeInstanceOf(MiniAppApiError);
      expect(err.code).toBe("upstream");
    }
  });

  it("says not_ready when PUBLIC_BASE_URL is missing", async () => {
    const err = await createMiniAppClient({ baseUrl: undefined }).quote({ from: "wBRL", to: "wARS", amount: "1" }).catch((e) => e);
    expect(err.code).toBe("not_ready");
  });

  it("maps errors to user-facing copy (no_route gets the no-market card)", () => {
    const e = (code: ConstructorParameters<typeof MiniAppApiError>[0]) => new MiniAppApiError(code, 400, "");
    expect(quoteErrorCopy(e("no_route"))).toBe("noMarket");
    expect(quoteErrorCopy(e("rate_limited"))).toBe("rateLimited");
    expect(quoteErrorCopy(e("bad_request"))).toBe("quoteBad");
    for (const code of ["upstream", "not_ready", "quote_expired", "price_changed", "needs_taker_proof"] as const) expect(quoteErrorCopy(e(code))).toBe("error");
    expect(quoteErrorCopy(new Error("boom"))).toBe("error");
  });

  it("fetches receipts by id only", async () => {
    const fetchFn = vi.fn(async () => json(200, {}));
    const client = createMiniAppClient({ baseUrl: "https://web.example", fetchFn: fetchFn as typeof fetch });
    await expect(client.receipt("../../etc")).rejects.toMatchObject({ code: "bad_request" });
    expect(fetchFn).not.toHaveBeenCalled();
    await expect(client.receipt("a7f3a7f3-0000-4000-8000-000000000029")).rejects.toMatchObject({ code: "upstream" });
    expect(fetchFn).toHaveBeenCalledWith("https://web.example/api/miniapp/receipt/a7f3a7f3-0000-4000-8000-000000000029", expect.anything());
  });
});
