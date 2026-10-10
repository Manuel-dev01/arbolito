/**
 * Private-beta gate. TELEGRAM_ALLOWED_USERS is a comma-separated list of numeric Telegram ids
 * and/or @usernames. Unset or empty means open to everyone. Numeric ids are preferred:
 * usernames can be changed and later claimed by someone else.
 */
export interface Allowlist {
  open: boolean;
  ids: Set<string>;
  usernames: Set<string>;
}

export function parseAllowlist(raw: string | undefined): Allowlist {
  const entries = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const ids = new Set(entries.filter((e) => /^\d+$/.test(e)));
  const usernames = new Set(entries.filter((e) => !/^\d+$/.test(e)).map((e) => e.replace(/^@/, "").toLowerCase()));
  return { open: entries.length === 0, ids, usernames };
}

/** How the user matched, so a username match can be logged and pinned to its numeric id. */
export function checkAccess(list: Allowlist, from: { id: number; username?: string }): "open" | "id" | "username" | "denied" {
  if (list.open) return "open";
  if (list.ids.has(String(from.id))) return "id";
  if (from.username && list.usernames.has(from.username.toLowerCase())) return "username";
  return "denied";
}
