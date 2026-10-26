import { describe, expect, it } from "vitest";
import { fmtRate } from "../src/refs";

describe("fmtRate", () => {
  it("keeps 8 significant digits as a plain decimal", () => {
    expect(fmtRate(1612.345678)).toBe("1612.3457");
    expect(fmtRate(0.000610995417)).toBe("0.00061099542");
  });

  it("never writes exponent notation (receipts parse rates as decimals)", () => {
    expect(fmtRate(3.402567868363881e26)).toBe("340256790000000000000000000");
    expect(fmtRate(1.2345678912e-9)).toBe("0.0000000012345679");
  });
});
