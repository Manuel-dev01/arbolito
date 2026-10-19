/**
 * pnpm register:8004 [--uri <url>] [--live] [--yes]
 *
 * Registers Arbolito on the ERC-8004 Identity Registry with register(agentURI). The URI defaults
 * to ${PUBLIC_BASE_URL}/.well-known/agent-registration.json, served by the web app
 * (apps/web/src/lib/agent-registration.ts). The script fetches it first and refuses to register
 * a file that isn't live or isn't a registration-v1 document.
 * Without --live: fetch, check and simulate register() (no transaction).
 * With --live: founder go-ahead required; sends via the guarded sender (attribution, $0 value).
 * After registering: set ERC8004_AGENT_ID (locally and on Vercel); the hosted file then lists it.
 */
import { decodeEventLog, encodeFunctionData, parseAbi } from "viem";
import { CONTRACTS, loadEnv, txUrl } from "@arbolito/config";
import { makePublicClient, makeWalletClient, sendGuarded } from "@arbolito/chain";
import { confirm, flagValue, hasFlag, opsAccount, runMain } from "./lib/cli";

const identityAbi = parseAbi([
  "function register(string agentURI) returns (uint256 agentId)",
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
]);

runMain(async () => {
  const env = loadEnv();
  const base = env.PUBLIC_BASE_URL?.replace(/\/$/, "");
  const uri = flagValue("uri") ?? (base ? `${base}/.well-known/agent-registration.json` : undefined);
  if (!uri) throw new Error("Set PUBLIC_BASE_URL or pass --uri");
  const live = hasFlag("live");
  const account = opsAccount();

  const res = await fetch(uri, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`${uri} answered ${res.status}`);
  const doc = (await res.json()) as { type?: string; name?: string; services?: { name: string; endpoint: string }[] };
  if (doc.type !== "https://eips.ethereum.org/EIPS/eip-8004#registration-v1" || !doc.name || !doc.services?.length) throw new Error(`${uri} is not a registration-v1 file`);
  if (JSON.stringify(doc).includes("{{")) throw new Error(`${uri} still has template placeholders`);
  console.log(`${uri}: "${doc.name}", services ${doc.services.map((x) => x.name).join(", ")}`);

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
