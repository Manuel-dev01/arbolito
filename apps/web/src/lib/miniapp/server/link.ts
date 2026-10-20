import type { Address } from "viem";
import type { z } from "zod";
import type { Hex } from "viem";
import { linkMessage, type LinkConfirmRequest, type LinkConfirmResponse } from "../contract";
import type { MiniappDeps } from "./deps";
import { badRequest, rateLimited } from "./errors";
import { signedBy } from "./signature";

/** Code guesses allowed per wallet and per IP in a 10-minute window (4 digits = 10,000 codes). */
const LINK_LIMIT_ACCOUNT = 5;
const LINK_LIMIT_IP = 20;
const LINK_WINDOW_MS = 10 * 60_000;

/** GET /link/status: whether a Telegram user owns this wallet (read-only; shows the name the user chose). */
export async function linkStatus(deps: MiniappDeps, account: Address): Promise<{ linked: boolean; telegramName: string | null }> {
  const u = await deps.store().userByWallet(account.toLowerCase());
  if (!u || u.telegramId === null) return { linked: false, telegramName: null };
  return { linked: true, telegramName: u.displayName ?? (u.telegramUsername ? `@${u.telegramUsername}` : null) };
}

/**
 * POST /link/confirm: "Conectá tu MiniPay". The bot shows a 4-digit code; the Mini App confirms it
 * for the wallet MiniPay injected. Sets users.wallet_address (lowercased) on the Telegram user.
 * If a MiniPay-only user already owns that wallet, its receipts and chat history move to the
 * Telegram user and the duplicate is deleted. The code is single-use.
 *
 * The wallet signs linkMessage(code, account) in MiniPay (personal_sign works there: the
 * MiniPay check, 2026-10-19). The signature is checked before the code is even looked up, so a
 * guessed code neither links someone else's wallet nor reveals whether it exists.
 */
export async function confirmLink(
  deps: MiniappDeps,
  req: z.infer<typeof LinkConfirmRequest>,
  ip: string,
): Promise<z.infer<typeof LinkConfirmResponse>> {
  const account = req.account.toLowerCase() as Address;
  if (!deps.limiter.take(`link:acct:${account}`, LINK_LIMIT_ACCOUNT, LINK_WINDOW_MS) || !deps.limiter.take(`link:ip:${ip}`, LINK_LIMIT_IP, LINK_WINDOW_MS)) {
    throw rateLimited("Too many attempts. Wait a few minutes and ask the bot for a new code.");
  }
  if (!(await signedBy(deps, account, linkMessage(req.code, account), req.proof as Hex))) throw badRequest("MiniPay's signature doesn't match. Try again.");
  const now = new Date(deps.now());

  return deps.store().transaction(async (store) => {
    const [code] = await store.activeLinkCodes(req.code, now);
    if (!code) throw badRequest("That code is wrong or expired. Ask the bot for a new one.");
    const tgUser = await store.userById(code.userId);
    if (!tgUser) throw badRequest("That code is wrong or expired. Ask the bot for a new one.");
    const telegramName = tgUser.displayName ?? (tgUser.telegramUsername ? `@${tgUser.telegramUsername}` : null);

    const owner = await store.userByWallet(account);
    if (owner && owner.id !== tgUser.id) {
      if (owner.telegramId !== null) throw badRequest("This wallet is already linked to another Telegram account.", 409);
      // MiniPay-only duplicate: fold it into the Telegram user, then free the wallet.
      await store.moveUserData(owner.id, tgUser.id);
      await store.deleteUser(owner.id);
    }
    if (!(await store.useLinkCode(code.id, account, now))) throw badRequest("That code was just used. Ask the bot for a new one.");
    if (tgUser.walletAddress !== account) await store.setUserWallet(tgUser.id, account);
    return { linked: true, telegramName };
  });
}
