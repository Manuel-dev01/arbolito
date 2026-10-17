import { createInterface } from "node:readline/promises";
import type { Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { loadEnv } from "@arbolito/config";

export const hasFlag = (name: string) => process.argv.includes(`--${name}`);
export function flagValue(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const VALUE_FLAGS = new Set(["--fee-currency", "--fork", "--receipts", "--uri", "--only", "--feed-base", "--bin"]);
export const positional = () => process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && !VALUE_FLAGS.has(all[i - 1] ?? ""));

/** anvil dev key #0. Only ever used with --fork, where it is a throwaway. */
const ANVIL_DEV_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

/** --fork <rpcUrl>: run the same script against an anvil fork instead of mainnet. */
export const forkUrl = () => flagValue("fork");

export function opsAccount(): PrivateKeyAccount {
  const key = loadEnv().OPS_PRIVATE_KEY;
  if (key) return privateKeyToAccount(key as Hex);
  if (forkUrl()) return privateKeyToAccount(ANVIL_DEV_KEY);
  throw new Error("OPS_PRIVATE_KEY is not set in .env (see docs/07-keys-setup.md)");
}

/** Interactive confirmation. `--yes` skips it, for runs the founder already approved. */
export async function confirm(prompt: string, expected = "send"): Promise<boolean> {
  if (hasFlag("yes")) return true;
  if (!process.stdin.isTTY) {
    console.error(`Not a TTY: re-run interactively, or pass --yes once the send is approved.`);
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${prompt}\nType "${expected}" to continue: `);
  rl.close();
  return answer.trim() === expected;
}

/**
 * Exit without calling process.exit() mid-teardown: on Windows that can trip a libuv
 * assertion while fetch sockets close. Let the loop drain; if a hung socket (e.g. a
 * timed-out DNS lookup) keeps it alive, the unref'd timer ends the process shortly after.
 */
export function exitSoon(code: number) {
  process.exitCode = code;
  setTimeout(() => process.exit(code), 250).unref();
}

export function runMain(main: () => Promise<void>) {
  main().then(
    () => exitSoon(0),
    (err: unknown) => {
      const e = err as { shortMessage?: string; message?: string };
      console.error(`failed: ${e.shortMessage ?? e.message ?? String(err)}`);
      exitSoon(1);
    },
  );
}
