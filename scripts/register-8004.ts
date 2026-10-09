/**
 * pnpm register:8004 --uri <https://…/agent-registration.json> [--live] [--yes]
 *
 * Renders identity/agent-registration.template.json from env (PUBLIC_BASE_URL etc.) to
 * .arbolito/agent-registration.json for hosting, then registers the agent on the
 * ERC-8004 Identity Registry with register(agentURI).
 * Without --live: renders and simulates register() (no transaction).
 * With --live: founder go-ahead required; sends via the guarded sender (attribution, $0 value).
 * After registering: put the agentId into "registrations", re-host the file, set ERC8004_AGENT_ID.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodeEventLog, encodeFunctionData, parseAbi } from "viem";
import { CONTRACTS, findRepoRoot, loadEnv, txUrl } from "@arbolito/config";
import { makePublicClient, makeWalletClient, sendGuarded } from "@arbolito/chain";
import { confirm, flagValue, hasFlag, opsAccount, runMain } from "./lib/cli";

const identityAbi = parseAbi([
  "function register(string agentURI) returns (uint256 agentId)",
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
]);

runMain(async () => {
  const env = loadEnv();
  const uri = flagValue("uri");
  const live = hasFlag("live");
  const account = opsAccount();

  const vars: Record<string, string | undefined> = {
    PUBLIC_BASE_URL: env.PUBLIC_BASE_URL?.replace(/\/$/, ""),
    TELEGRAM_BOT_HANDLE: process.env.TELEGRAM_BOT_HANDLE,
    FX_API_URL: process.env.FX_API_URL,
    MCP_URL: process.env.MCP_URL,
    AGENT_WALLET: account.address,
  };
  const root = findRepoRoot();
  const template = readFileSync(join(root, "identity", "agent-registration.template.json"), "utf8");
  const missing = [...template.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]!).filter((k, i, a) => a.indexOf(k) === i && !vars[k]);
  const rendered = template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? `{{${k}}}`);
  const out = join(root, ".arbolito", "agent-registration.json");
  mkdirSync(join(root, ".arbolito"), { recursive: true });
  writeFileSync(out, rendered);
  console.log(`Rendered ${out}`);
  if (missing.length) console.log(`  still templated (set these before registering): ${missing.join(", ")}`);

  if (!uri) {
    console.log("\nHost the rendered file over HTTPS, then re-run with --uri <url>.");
    return;
  }
  if (live && missing.length) throw new Error("Refusing to register a registration file with unfilled placeholders");

  const publicClient = makePublicClient();
  const { result: simulatedId } = await publicClient.simulateContract({
    account,
    address: CONTRACTS.erc8004.identity,
    abi: identityAbi,
    functionName: "register",
    args: [uri],
  });
  console.log(`\nregister("${uri}") from ${account.address}\n  simulated agentId: ${simulatedId}`);
  if (!live) {
    console.log("\nDry run only. Re-run with --live after the founder approves.");
    return;
  }
  if (!(await confirm("\nThis mints the ERC-8004 identity NFT on Celo mainnet.", "register"))) {
    console.log("Aborted. Nothing was sent.");
    return;
  }
  const { hash, receipt } = await sendGuarded({
    mode: "live",
    live: true,
    publicClient,
    walletClient: makeWalletClient(account),
    to: CONTRACTS.erc8004.identity,
    data: encodeFunctionData({ abi: identityAbi, functionName: "register", args: [uri] }),
    usdMicros: 0n,
    purpose: "ERC-8004 register",
  });
  const ev = receipt.logs
    .filter((l) => l.address.toLowerCase() === CONTRACTS.erc8004.identity.toLowerCase())
    .map((l) => {
      try {
        return decodeEventLog({ abi: identityAbi, data: l.data, topics: l.topics });
      } catch {
        return null;
      }
    })
    .find((e) => e?.eventName === "Registered");
  console.log(`\nRegistered: ${txUrl(hash)}\nagentId: ${ev?.args.agentId ?? "(see tx logs)"}`);
  console.log(`Next: add {"agentId": <id>, "agentRegistry": "eip155:42220:${CONTRACTS.erc8004.identity}"} to registrations, re-host, set ERC8004_AGENT_ID.`);
});
