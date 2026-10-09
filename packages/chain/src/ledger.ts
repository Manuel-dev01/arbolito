import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { findRepoRoot } from "@arbolito/config";

/** USD amounts are micro-USD bigints (6 decimals), matching the atomic-units rule. */
export const USD = (dollars: number) => BigInt(Math.round(dollars * 1_000_000));
export const formatUsd = (micros: bigint) => `$${(Number(micros) / 1_000_000).toFixed(2)}`;

export interface LedgerEntry {
  id: string;
  at: string;
  purpose: string;
  usdMicros: string;
  status: "reserved" | "sent" | "confirmed" | "released";
  txHash?: string;
}

/** Async so a database can back it (packages/db DbLedger); memory and file ledgers resolve immediately. */
export interface SpendLedger {
  spent(dayUtc: string): Promise<bigint>;
  reserve(dayUtc: string, entry: Omit<LedgerEntry, "status">): Promise<void>;
  update(dayUtc: string, id: string, patch: Partial<LedgerEntry>): Promise<void>;
}

export const utcDay = (d: Date) => d.toISOString().slice(0, 10);

function sumActive(entries: LedgerEntry[]): bigint {
  return entries.filter((e) => e.status !== "released").reduce((acc, e) => acc + BigInt(e.usdMicros), 0n);
}

export class MemoryLedger implements SpendLedger {
  private days = new Map<string, LedgerEntry[]>();
  async spent(day: string) {
    return sumActive(this.days.get(day) ?? []);
  }
  async reserve(day: string, entry: Omit<LedgerEntry, "status">) {
    const list = this.days.get(day) ?? [];
    list.push({ ...entry, status: "reserved" });
    this.days.set(day, list);
  }
  async update(day: string, id: string, patch: Partial<LedgerEntry>) {
    const e = this.days.get(day)?.find((x) => x.id === id);
    if (e) Object.assign(e, patch);
  }
}

/**
 * Daily spend ledger in a gitignored JSON file. Stands in for packages/db until Phase 2.
 * Reservations are written before signing, so a crash mid-send still counts against the cap.
 */
export class FileLedger implements SpendLedger {
  constructor(readonly path = join(findRepoRoot(), ".arbolito", "spend-ledger.json")) {}
  private read(): Record<string, LedgerEntry[]> {
    if (!existsSync(this.path)) return {};
    return JSON.parse(readFileSync(this.path, "utf8")) as Record<string, LedgerEntry[]>;
  }
  private write(data: Record<string, LedgerEntry[]>) {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, this.path);
  }
  async spent(day: string) {
    return sumActive(this.read()[day] ?? []);
  }
  async reserve(day: string, entry: Omit<LedgerEntry, "status">) {
    const data = this.read();
    (data[day] ??= []).push({ ...entry, status: "reserved" });
    this.write(data);
  }
  async update(day: string, id: string, patch: Partial<LedgerEntry>) {
    const data = this.read();
    const e = data[day]?.find((x) => x.id === id);
    if (e) {
      Object.assign(e, patch);
      this.write(data);
    }
  }
}
