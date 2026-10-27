/**
 * Vitest globalSetup for the `fork` project:
 * 1. forge build (the e2e deploys ArbolitoReceipts from its artifact)
 * 2. anvil --fork-url <CELO_RPC_URL> at a recent mainnet block, chainId 42220
 * 3. provide the anvil URL to tests; kill anvil on teardown
 * FORK_BLOCK pins a specific block; otherwise latest-2 (forno serves recent state reliably).
 * FORK_PORT picks the anvil port (default 8547); use a free one when another session is running.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import type { TestProject } from "vitest/node";
import { loadEnv, findRepoRoot } from "@arbolito/config";

declare module "vitest" {
  export interface ProvidedContext {
    forkRpcUrl: string;
    forkBlock: string;
  }
}

// FORK_PORT lets parallel sessions run their own anvil instead of sharing (or hijacking) 8547.
const PORT = Number(process.env.FORK_PORT ?? 8547);
let anvil: ChildProcess | undefined;

async function rpc(url: string, method: string, params: unknown[] = []): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (body.error) throw new Error(body.error.message);
  return body.result;
}

/** forno occasionally drops a request; retry the one upstream call setup makes. */
async function latestBlock(upstream: string): Promise<bigint> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      return BigInt((await rpc(upstream, "eth_blockNumber")) as string);
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  throw new Error(`Upstream RPC ${upstream} unreachable: ${(lastErr as Error).message}`);
}

export async function setup(project: TestProject) {
  const root = findRepoRoot();
  execFileSync("forge", ["build", "--root", "contracts"], { cwd: root, stdio: "inherit" });

  // A fork reads state at its pinned block for the whole run, which needs an archive node. The
  // primary (Chainstack's free Global Node) isn't one, so fork from the fallback (forno) when set.
  const env = loadEnv();
  const upstream = env.CELO_RPC_URL_FALLBACK ?? env.CELO_RPC_URL;
  const forkBlock = process.env.FORK_BLOCK ? BigInt(process.env.FORK_BLOCK) : (await latestBlock(upstream)) - 2n;

  // Refuse to run against someone else's node: if the port already answers, our anvil could not
  // bind and the readiness loop below would happily talk to the other instance.
  const portBusy = await rpc(`http://127.0.0.1:${PORT}`, "eth_chainId").then(
    () => true,
    () => false,
  );
  if (portBusy) throw new Error(`Port ${PORT} is already serving JSON-RPC; set FORK_PORT to a free port`);

  try {
    anvil = spawn(
      "anvil",
      [
        "--fork-url", upstream,
        "--fork-block-number", forkBlock.toString(),
        "--chain-id", "42220",
        "--port", String(PORT),
        // Keep mining: with on-demand mining only, viem's waitForTransactionReceipt can miss a tx
        // that was mined before its block watcher started, and then wait forever for a new block.
        "--block-time", "1",
        "--retries", "8",
        "--timeout", "45000",
        "--silent",
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
  } catch (err) {
    throw new Error(`Could not start anvil (install Foundry): ${(err as Error).message}`);
  }
  let stderr = "";
  let spawnError: Error | undefined;
  anvil.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
  anvil.on("error", (err) => (spawnError = err));
  // A failed setup never reaches teardown, so make sure anvil can't outlive this process.
  process.once("exit", () => anvil?.kill());

  const url = `http://127.0.0.1:${PORT}`;
  const deadline = Date.now() + 120_000;
  try {
    for (;;) {
      try {
        if ((await rpc(url, "eth_chainId")) === "0xa4ec") break;
      } catch {
        /* not up yet */
      }
      if (spawnError) throw new Error(`anvil failed to start (is Foundry installed?): ${spawnError.message}`);
      if (anvil.exitCode !== null) throw new Error(`anvil exited early (code ${anvil.exitCode}): ${stderr}`);
      if (Date.now() > deadline) throw new Error(`anvil did not answer within 120s: ${stderr}`);
      await new Promise((r) => setTimeout(r, 250));
    }
  } catch (err) {
    anvil.kill();
    throw err;
  }

  project.provide("forkRpcUrl", url);
  project.provide("forkBlock", forkBlock.toString());
}

export async function teardown() {
  anvil?.kill();
}
