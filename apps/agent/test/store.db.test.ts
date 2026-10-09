/**
 * Bot persistence against the real Postgres (vitest `db` project). Uses throwaway Telegram
 * ids and deletes its users afterwards (contacts/pending/messages cascade).
 */
import { afterAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { closeDb, getDb, users } from "@arbolito/db";
import type { ChatMessage } from "@arbolito/llm";
import {
  addContact,
  appendHistory,
  createPending,
  findContact,
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
