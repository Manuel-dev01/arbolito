/**
 * Local Stitch tooling for the desk. Stitch's files live in .arbolito/stitch/ (gitignored):
 * stitch.toml (generated, then edited by `connect`) and rfq-api.key (the maker credential).
 * The desk key goes to Stitch only through its environment; it is never written or printed.
 *
 *   pnpm desk:stitch init [--feed-base <url>]         write stitch.toml from corridors.ts (keeps an existing [rfq])
 *   pnpm desk:stitch connect --bin <stitch.exe>       register the desk wallet as a Textile maker
 *   pnpm desk:stitch verify-email <address>           ask Textile to send the confirmation link
 *   pnpm desk:stitch status                           Textile's view of the maker (email, seats)
 *   pnpm desk:stitch run --bin <stitch.exe> [--dry-run]  run the bot
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { findRepoRoot, loadEnv } from "@arbolito/config";
import { CORRIDORS, stitchToml } from "@arbolito/desk";
import { flagValue, hasFlag, runMain } from "./lib/cli";

const dir = join(findRepoRoot(), ".arbolito", "stitch");
const configPath = join(dir, "stitch.toml");
const keyPath = join(dir, "rfq-api.key");

function deskKey(): Hex {
  const k = loadEnv().DESK_PRIVATE_KEY;
  if (!k) throw new Error("DESK_PRIVATE_KEY is not set");
  return k as Hex;
}

/** The [rfq] block `stitch connect` wrote, so regenerating the config keeps the enrollment. */
function existingRfq(): string | undefined {
  if (!existsSync(configPath)) return undefined;
  const m = /^\[rfq\][\s\S]*?(?=^\[|(?![\s\S]))/m.exec(readFileSync(configPath, "utf8"));
  return m?.[0].trimEnd();
}

function venueOrigin(): string {
  const toml = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  const url = /^\s*url\s*=\s*"(wss?:\/\/[^"]+)"/m.exec(toml.slice(toml.indexOf("[rfq]")))?.[1];
  const origin = (url ?? "https://api.textilecredit.com").replace(/^wss:/, "https:").replace(/^ws:/, "http:");
  return origin.replace(/\/v2\/maker\/stream\/?$/, "").replace(/\/$/, "");
}

function makerKey(): string {
  if (!existsSync(keyPath)) throw new Error("no maker credential yet: run `pnpm desk:stitch connect` first");
  return readFileSync(keyPath, "utf8").trim();
}

function runStitch(args: string[]): Promise<number> {
  const bin = flagValue("bin");
  if (!bin) throw new Error("pass --bin <path to the stitch binary> (checksum-verified release)");
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: dir,
      stdio: "inherit",
      env: { ...process.env, STITCH_PRIVATE_KEY: deskKey(), ...(existsSync(keyPath) ? { STITCH_RFQ_API_KEY_FILE: keyPath } : {}) },
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function venue(path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${venueOrigin()}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${makerKey()}`, "content-type": "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

runMain(async () => {
  const cmd = process.argv[2];
  mkdirSync(dir, { recursive: true });
  if (cmd === "init") {
    const base = flagValue("feed-base") ?? `http://127.0.0.1:${loadEnv().DESK_FEED_PORT}`;
    const rfq = existingRfq();
    writeFileSync(configPath, stitchToml(CORRIDORS, { feedBaseUrl: base, rpcUrl: loadEnv().CELO_RPC_URL }) + (rfq ? `\n${rfq}\n` : ""));
    console.log(`wrote ${configPath} (feed ${base}${rfq ? ", kept [rfq]" : ""}) for maker wallet ${privateKeyToAccount(deskKey()).address}`);
  } else if (cmd === "connect") {
    if (!existsSync(configPath)) throw new Error("run `pnpm desk:stitch init` first");
    process.exitCode = await runStitch(["connect", "--config", configPath]);
  } else if (cmd === "run") {
    process.exitCode = await runStitch(["--config", configPath, ...(hasFlag("dry-run") ? ["--dry-run"] : [])]);
  } else if (cmd === "verify-email") {
    const email = process.argv[3];
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("usage: pnpm desk:stitch verify-email <address>");
    const r = (await venue("/v2/maker/verify-email", { method: "POST", body: JSON.stringify({ contactEmail: email, botName: "Arbolito Desk" }) })) as { emailVerified?: boolean };
    console.log(r.emailVerified ? `${email} is already confirmed.` : `Textile is sending a confirmation link to ${email}. Click it, then run \`pnpm desk:stitch status\`.`);
  } else if (cmd === "status") {
    console.log(JSON.stringify(await venue("/v2/maker/status"), null, 2));
  } else {
    throw new Error("usage: pnpm desk:stitch <init|connect|verify-email|status|run> (see the header of scripts/desk-stitch.ts)");
  }
});
