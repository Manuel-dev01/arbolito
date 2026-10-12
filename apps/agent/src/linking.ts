/**
 * "Conectá tu MiniPay" in Telegram: create a code, show it with a link into the mini app, poll
 * link_codes.used_at every ~3 s until expiry, then confirm with the masked wallet. The bot edits
 * the code message when it's used or expires, so a stale code can't be followed.
 */
import type { Api } from "grammy";
import { log } from "@arbolito/chain";
import type { Db } from "@arbolito/db";
import { renderLinkCode, renderLinked, type LinkCodeState } from "./card";
import type { Lang } from "./i18n";
import { LINK_POLL_MS, pollUntil } from "./link";
import type { Links } from "./links";
import { createLinkCode, getLinkCode, getUserById, type User } from "./store";

interface Active {
  cancel: () => void;
  chatId: number;
  messageId: number;
  code: string;
  lang: Lang;
}

export interface LinkerDeps {
  db: Db;
  api: Api;
  links: Links | null;
  now?: () => number;
  pollMs?: number;
}

export class Linker {
  private active = new Map<string, Active>();

  constructor(private readonly d: LinkerDeps) {}

  /** Creates a code for `user` and starts watching it. A previous code of theirs is retired. */
  async start(chatId: number, user: User, lang: Lang): Promise<void> {
    const prev = this.active.get(user.id);
    if (prev) {
      prev.cancel();
      this.active.delete(user.id);
      await this.edit(prev, "expired");
    }
    const code = await createLinkCode(this.d.db, user.id, this.d.now ? { now: this.d.now() } : {});
    const r = renderLinkCode("active", code.code, lang, this.d.links);
    const msg = await this.d.api.sendMessage(chatId, r.text, { parse_mode: "HTML", reply_markup: r.keyboard });
    const entry: Active = { cancel: () => {}, chatId, messageId: msg.message_id, code: code.code, lang };
    this.active.set(user.id, entry);

    const finish = () => {
      if (this.active.get(user.id) === entry) this.active.delete(user.id);
    };
    entry.cancel = pollUntil({
      intervalMs: this.d.pollMs ?? LINK_POLL_MS,
      deadline: code.expiresAt.getTime(),
      ...(this.d.now ? { now: this.d.now } : {}),
      check: async () => {
        const row = await getLinkCode(this.d.db, code.id);
        if (!row) {
          finish();
          return true;
        }
        if (!row.usedAt) return false;
        finish();
        await this.edit(entry, "used");
        const wallet = row.account ?? (await getUserById(this.d.db, user.id))?.walletAddress ?? "";
        await this.d.api.sendMessage(chatId, renderLinked(lang, wallet), { parse_mode: "HTML" });
        log(`[link] user ${user.id} linked a MiniPay wallet`);
        return true;
      },
      onTimeout: async () => {
        finish();
        await this.edit(entry, "expired");
      },
      onError: (err) => log(`[link] poll failed: ${(err as Error).message}`),
    });
  }

  stop(): void {
    for (const a of this.active.values()) a.cancel();
    this.active.clear();
  }

  private async edit(a: Active, state: LinkCodeState) {
    const r = renderLinkCode(state, a.code, a.lang, this.d.links);
    await this.d.api.editMessageText(a.chatId, a.messageId, r.text, { parse_mode: "HTML", reply_markup: r.keyboard }).catch((err) => {
      if (!/message is not modified/i.test((err as Error).message ?? "")) log(`[link] edit failed: ${(err as Error).message}`);
    });
  }
}
