/**
 * Bot persistence against the real Postgres (vitest `db` project). Uses throwaway Telegram
 * ids and deletes its users afterwards (contacts/pending/messages cascade).
 */
import { randomBytes, randomInt } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import type { Api } from "grammy";
import { closeDb, getDb, linkCodes, users } from "@arbolito/db";
import type { ChatMessage } from "@arbolito/llm";
import { LINK_CODE_TTL_MS } from "../src/link";
import { Linker } from "../src/linking";
import { makeLinks } from "../src/links";
import {
  addContact,
  appendHistory,
  countActiveCodes,
  createLinkCode,
  createPending,
  findContact,
  getLinkCode,
  getPending,
  listContacts,
  loadHistory,
  transitionPending,
  upsertUser,
} from "../src/store";

const db = getDb();
const base = 9_000_000_000 + Math.floor(Math.random() * 1_000_000);
const created: string[] = [];

afterAll(async () => {
  if (created.length) await db.delete(users).where(inArray(users.id, created));
  await closeDb();
});

async function newUser(offset: number, language_code = "es") {
  const u = await upsertUser(db, { id: base + offset, username: `test${offset}`, first_name: "Test", language_code });
  created.push(u.id);
  return u;
}

describe("users", () => {
  it("creates on first contact and updates on the next, keeping the same id", async () => {
    const a = await newUser(1, "pt-BR");
    expect(a.language).toBe("pt");
    expect(a.maxActionMicros).toBe("25000000");
    const again = await upsertUser(db, { id: base + 1, username: "renamed", first_name: "Test" });
    expect(again.id).toBe(a.id);
    expect(again.telegramUsername).toBe("renamed");
  });
});

describe("pending actions", () => {
  it("transitions atomically: a double Confirm can only win once", async () => {
    const u = await newUser(2);
    const p = await createPending(db, u.id, "convert", { route: null }, 60_000);
    const [a, b] = await Promise.all([
      transitionPending(db, p.id, "pending", "confirmed"),
      transitionPending(db, p.id, "pending", "confirmed"),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect((await getPending(db, p.id, u.id))?.status).toBe("confirmed");
    expect(await transitionPending(db, p.id, "pending", "cancelled")).toBe(false);
  });

  it("is invisible to other users", async () => {
    const owner = await newUser(3);
    const other = await newUser(4);
    const p = await createPending(db, owner.id, "convert", {}, 60_000);
    expect(await getPending(db, p.id, other.id)).toBeUndefined();
    expect(await getPending(db, p.id, owner.id)).toBeDefined();
  });
});

describe("contacts", () => {
  it("saves, finds case-insensitively, and updates on re-save", async () => {
    const u = await newUser(5);
    await addContact(db, u.id, "Lucía", "0x000000000000000000000000000000000000dEaD");
    expect((await findContact(db, u.id, "  LUCÍA "))?.address).toBe("0x000000000000000000000000000000000000dEaD");
    await addContact(db, u.id, "lucía", "0x000000000000000000000000000000000000bEEF");
    const all = await listContacts(db, u.id);
    expect(all).toHaveLength(1);
    expect(all[0]!.address).toBe("0x000000000000000000000000000000000000bEEF");
  });
});

describe("history", () => {
  it("returns messages oldest first and never starts with a dangling tool result", async () => {
    const u = await newUser(6);
    const msgs: ChatMessage[] = [
      { role: "user", content: "hola" },
      { role: "assistant", content: "¡Hola!" },
      { role: "user", content: "cuánto tengo" },
      { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "get_balances", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "c1", content: "{}" },
      { role: "assistant", content: "Tenés 0." },
    ] as ChatMessage[];
    await appendHistory(db, u.id, msgs);
    expect((await loadHistory(db, u.id, 20)).map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant", "tool", "assistant"]);
    // A window that would start mid-turn is trimmed to the next user message.
    const tail = await loadHistory(db, u.id, 3);
    expect(tail[0]?.role ?? "user").toBe("user");
  });
});

describe("link codes", () => {
  /** What the web backend does on /api/miniapp/link/confirm (simulated here). */
  async function confirmFromMiniApp(codeId: string, userId: string, account: string) {
    await db.update(linkCodes).set({ usedAt: new Date(), account }).where(eq(linkCodes.id, codeId));
    await db.update(users).set({ walletAddress: account }).where(eq(users.id, userId));
  }
  const randomWallet = () => `0x${randomBytes(20).toString("hex")}`;

  it("creates a 4-digit code with a 10-minute expiry, unused", async () => {
    const u = await newUser(10);
    const before = Date.now();
    const c = await createLinkCode(db, u.id);
    expect(c.code).toMatch(/^\d{4}$/);
    expect(c.usedAt).toBeNull();
    expect(c.account).toBeNull();
    expect(c.expiresAt.getTime()).toBeGreaterThanOrEqual(before + LINK_CODE_TTL_MS);
    expect(c.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + LINK_CODE_TTL_MS);
  });

  it("a new code retires the user's previous one", async () => {
    const u = await newUser(11);
    const first = await createLinkCode(db, u.id);
    const second = await createLinkCode(db, u.id);
    expect((await getLinkCode(db, first.id))!.expiresAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect((await getLinkCode(db, second.id))!.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("never hands out a code that is active for someone else", async () => {
    const a = await newUser(12);
    const b = await newUser(13);
    const ca = await createLinkCode(db, a.id);
    // b's random source first proposes a's active code; allocation must skip it.
    let calls = 0;
    const rand = (min: number, max: number) => (calls++ === 0 ? Number(ca.code) : randomInt(min, max));
    const cb = await createLinkCode(db, b.id, { rand });
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(cb.code).not.toBe(ca.code);
    expect(await countActiveCodes(db, ca.code)).toBe(1);
  });

  it("allocations racing each other still yield distinct active codes", async () => {
    const racers = await Promise.all([14, 15, 16, 17, 18].map((o) => newUser(o)));
    const codes = await Promise.all(racers.map((u) => createLinkCode(db, u.id)));
    expect(new Set(codes.map((c) => c.code)).size).toBe(codes.length);
  });

  it("full lifecycle: code shown, confirmed in MiniPay, bot polls and confirms with the masked wallet", async () => {
    const u = await newUser(19);
    const wallet = randomWallet();
    const sendMessage = vi.fn(async (_chat: number, _text: string, _o?: unknown) => ({ message_id: 501 }));
    const editMessageText = vi.fn(async (..._a: unknown[]) => true);
    const linker = new Linker({ db, api: { sendMessage, editMessageText } as unknown as Api, links: makeLinks("https://mini.example"), pollMs: 100 });
    await linker.start(777, u, "es");
    const [, codeText] = sendMessage.mock.calls[0]!;
    const code = /<code>(\d{4})<\/code>/.exec(codeText)![1]!;
    const [row] = await db.select().from(linkCodes).where(eq(linkCodes.userId, u.id)).orderBy(linkCodes.createdAt);
    expect(row!.code).toBe(code);

    await confirmFromMiniApp(row!.id, u.id, wallet);
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(2), { timeout: 5_000, interval: 50 });
    expect(sendMessage.mock.calls[1]![1]).toContain(`<b>${wallet.slice(0, 6)}…${wallet.slice(-4)}</b>`);
    expect(editMessageText.mock.calls[0]![2]).toContain("✓ Usado.");
    linker.stop();
  });
});
