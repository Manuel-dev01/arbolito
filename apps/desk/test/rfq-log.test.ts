import { describe, expect, it } from "vitest";
import { parseRfqResult } from "../src";

describe("Stitch RFQ log lines", () => {
  it("reads the RFQ id and result of a won quote, and nothing else", () => {
    const line = "2026-10-20T13:22:51.776063Z  INFO stitch_bot::rfq: quote result rfq_id=rfq_JZJLEVrlKTVw6446 result=selected";
    expect(parseRfqResult(line)).toEqual({ rfqId: "rfq_JZJLEVrlKTVw6446", result: "selected" });
    expect(parseRfqResult("INFO stitch: tick pair=0x…/0x… price=0.19")).toBeNull();
    expect(parseRfqResult("INFO stitch_bot::rfq: quote result; no local reservation")).toBeNull();
  });
});
