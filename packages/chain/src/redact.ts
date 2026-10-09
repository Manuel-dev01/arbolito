import { loadEnv } from "@arbolito/config";

const SECRET_KEYS = [
  "OPS_PRIVATE_KEY",
  "DESK_PRIVATE_KEY",
  "BUY_PAYER_PRIVATE_KEY",
  "TEXTILE_API_KEY",
  "TEXTILE_WEBHOOK_SECRET",
  "X402_API_KEY",
  "ANTHROPIC_API_KEY",
  "DEEPSEEK_API_KEY",
  "STT_API_KEY",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET",
  "THIRDWEB_SECRET_KEY",
  "DATABASE_URL",
] as const;

/** Masks every configured secret value, plus buy poll URLs (bearer capabilities). */
export function redact(text: string): string {
  let out = text;
  let env: ReturnType<typeof loadEnv> | undefined;
  try {
    env = loadEnv();
  } catch {
    env = undefined;
  }
  for (const k of SECRET_KEYS) {
    const v = env?.[k];
    if (typeof v === "string" && v.length >= 8) out = out.split(v).join(`[${k}]`);
  }
  return out.replace(/https?:\/\/[^\s"']*\/poll[^\s"']*/gi, "[poll-url]");
}

export const log = (...parts: unknown[]) =>
  console.log(redact(parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p, bigintJson))).join(" ")));

export function bigintJson(_k: string, v: unknown) {
  return typeof v === "bigint" ? v.toString() : v;
}
