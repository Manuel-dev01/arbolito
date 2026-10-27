import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { StitchSupervisor } from "../src/supervisor";

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("StitchSupervisor", () => {
  it("backs off after a crash even while the feed keeps applying config", async () => {
    // node rejects "--config" as an option and exits at once: a Stitch that crashes on start.
    const lines: string[] = [];
    const sup = new StitchSupervisor({ bin: process.execPath, dir: mkdtempSync(join(tmpdir(), "stitch-")), privateKey: "0x00", rfqApiKey: "k", log: (l) => lines.push(l) });
    try {
      sup.apply("a = 1");
      await pause(1_500);
      expect(sup.status().restarts).toBe(1);
      // The feed ticks every ~10 s with a fresh config; none of these may restart inside the 5 s backoff.
      for (const v of [2, 3, 4]) {
        sup.apply(`a = ${v}`);
        await pause(300);
      }
      expect(sup.status().restarts).toBe(1);
      expect(sup.status().pendingChange).toBe(true);
      expect(lines.some((l) => l.includes("restarting in 5s"))).toBe(true);
    } finally {
      await sup.stop();
    }
  }, 15_000);
});
