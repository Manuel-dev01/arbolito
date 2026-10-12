/**
 * The bot mirrors part of the web contract (it can't import apps/web at runtime). This fails
 * if the mirror and apps/web/src/lib/miniapp/contract.ts drift apart.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as web from "../../web/src/lib/miniapp/contract";
import * as mine from "../src/contract";

const schema = (s: z.ZodType) => z.toJSONSchema(s, { io: "input" });

describe("Mini App contract mirror", () => {
  it.each(["Sym", "Lang", "ApiErrorCode", "ApiError", "Reference", "QuoteRequest", "QuoteResponse", "ReceiptStatus", "ReceiptResponse"] as const)("%s matches the web contract", (name) => {
    expect(schema(mine[name] as z.ZodType)).toEqual(schema(web[name] as z.ZodType));
  });

  it("parses the bot's symbols the same way", () => {
    expect(mine.SYMBOLS).toEqual(web.SYMBOLS);
    expect(mine.parseSym("wbrl")).toBe("wBRL");
    expect(mine.parseSym("USA₮")).toBe("USAT");
    expect(mine.parseSym("USD₮")).toBe("USDT");
    expect(mine.parseSym("DOGE")).toBeNull();
  });
});
