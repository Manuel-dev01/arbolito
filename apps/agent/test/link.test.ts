import { afterEach, describe, expect, it, vi } from "vitest";
import { LINK_CODE_TTL_MS, generateLinkCode, linkCodeExpiry, pollUntil } from "../src/link";

describe("link codes", () => {
  it("are 4 digits, zero-padded, across the whole range", () => {
    expect(generateLinkCode(() => 0)).toBe("0000");
    expect(generateLinkCode(() => 42)).toBe("0042");
    expect(generateLinkCode(() => 9999)).toBe("9999");
    for (let i = 0; i < 200; i++) expect(generateLinkCode()).toMatch(/^\d{4}$/);
  });

  it("draw from the injected source over [0, 10000), defaulting to node:crypto", () => {
    const rand = vi.fn(() => 1234);
    expect(generateLinkCode(rand)).toBe("1234");
    expect(rand).toHaveBeenCalledWith(0, 10_000);
    expect(() => generateLinkCode(() => 10_000)).toThrow(RangeError);
    expect(() => generateLinkCode(() => 1.5)).toThrow(RangeError);
  });

  it("aren't predictable: the default CSPRNG spreads codes out", () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateLinkCode()));
    expect(seen.size).toBeGreaterThan(450);
  });

  it("expire after 10 minutes", () => {
    expect(LINK_CODE_TTL_MS).toBe(600_000);
    expect(linkCodeExpiry(1_000).getTime()).toBe(601_000);
  });
});

describe("pollUntil", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("checks every interval until done", async () => {
    vi.useFakeTimers();
    let n = 0;
    const onTimeout = vi.fn();
    pollUntil({ intervalMs: 3_000, deadline: Date.now() + 60_000, check: async () => ++n === 3, onTimeout });
    await vi.advanceTimersByTimeAsync(2_999);
    expect(n).toBe(0);
    await vi.advanceTimersByTimeAsync(9_001);
    expect(n).toBe(3);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(n).toBe(3);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("times out at the deadline (after one last check) and keeps going through errors", async () => {
    vi.useFakeTimers();
    const errors: unknown[] = [];
    let n = 0;
    const onTimeout = vi.fn();
    pollUntil({
      intervalMs: 3_000,
      deadline: Date.now() + 10_000,
      check: async () => {
        n++;
        if (n === 1) throw new Error("db blip");
        return false;
      },
      onTimeout,
      onError: (e) => errors.push(e),
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(errors).toHaveLength(1);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(n).toBe(4); // 3s, 6s, 9s, 10s
  });

  it("stops when cancelled", async () => {
    vi.useFakeTimers();
    const check = vi.fn(async () => false);
    const cancel = pollUntil({ intervalMs: 1_000, deadline: Date.now() + 10_000, check, onTimeout: vi.fn() });
    await vi.advanceTimersByTimeAsync(2_500);
    cancel();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(check).toHaveBeenCalledTimes(2);
  });
});
