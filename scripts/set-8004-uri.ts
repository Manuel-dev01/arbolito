/**
 * pnpm set:8004-uri [--uri <url>] [--fork <rpc>] [--live] [--yes]
 *
 * Re-points (or re-announces) Arbolito's ERC-8004 identity with setAgentURI(9976, uri), so indexers
 * such as 8004scan re-read the registration file after its services change. Gas only. The URI
 * defaults to ${PUBLIC_BASE_URL}/.well-known/agent-registration.json; the script fetches and checks
 * it first, then simulates. --fork rehearses on an anvil fork; --live sends on mainnet (founder
 * go-ahead) through the guarded sender (simulated, tagged, $0 value).
 */
import { encodeFunctionData, parseAbi } from "viem";
import { CONTRACTS, loadEnv, txUrl } from "@arbolito/config";
import { makePublicClient, makeWalletClient, sendGuarded } from "@arbolito/chain";
import { confirm, flagValue, forkUrl, hasFlag, opsAccount, runMain } from "./lib/cli";

const identityAbi = parseAbi(["function setAgentURI(uint256 agentId, string newURI)", "function tokenURI(uint256 agentId) view returns (string)", "function ownerOf(uint256 agentId) view returns (address)"]);

runMain(async () => {
  const env = loadEnv();
  const agentId = BigInt(env.ERC8004_AGENT_ID ?? "9976");
  const base = env.PUBLIC_BASE_URL?.replace(/\/$/, "") ?? "https://arbolito-livid.vercel.app";
  const uri = flagValue("uri") ?? `${base}/.well-known/agent-registration.json`;
  const fork = forkUrl();
  const live = hasFlag("live");
  const account = opsAccount();

  const res = await fetch(uri, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`${uri} answered ${res.status}`);
  const doc = (await res.json()) as { type?: string; services?: { name: string }[]; registrations?: { agentId: number }[] };
  if (doc.type !== "https://eips.ethereum.org/EIPS/eip-8004#registration-v1" || !doc.services?.length) throw new Error(`${uri} is not a registration-v1 file`);
  if (!doc.registrations?.some((r) => BigInt(r.agentId) === agentId)) throw new Error(`${uri} doesn't list agentId ${agentId}`);
  console.log(`${uri}: services ${doc.services.map((x) => x.name).join(", ")}`);

  const publicClient = makePublicClient(fork ? { rpcUrl: fork } : {});
  const [owner, current] = await Promise.all([
    publicClient.readContract({ address: CONTRACTS.erc8004.identity, abi: identityAbi, functionName: "ownerOf", args: [agentId] }),
    publicClient.readContract({ address: CONTRACTS.erc8004.identity, abi: identityAbi, functionName: "tokenURI", args: [agentId] }),
  ]);
  if (owner.toLowerCase() !== account.address.toLowerCase()) throw new Error(`agent ${agentId} is owned by ${owner}, not ${account.address}`);
  console.log(`agent ${agentId}: owner ${owner}; current URI ${current}${current === uri ? " (same: this re-announces it)" : ""}`);
  await publicClient.simulateContract({ account, address: CONTRACTS.erc8004.identity, abi: identityAbi, functionName: "setAgentURI", args: [agentId, uri] });
  console.log("simulated setAgentURI: ok");
  if (!live && !fork) {
    console.log("Dry run only. --fork <rpc> to rehearse, --live to send.");
    return;
  }
  if (live && !(await confirm(`\nsetAgentURI(${agentId}, "${uri}") on Celo mainnet (gas only).`, "send"))) {
    console.log("Aborted. Nothing was sent.");
    return;
  }
  const { hash } = await sendGuarded({
    mode: fork ? "fork" : "live",
    live: !fork,
    publicClient,
    walletClient: makeWalletClient(account, fork ? { rpcUrl: fork } : {}),
    to: CONTRACTS.erc8004.identity,
    data: encodeFunctionData({ abi: identityAbi, functionName: "setAgentURI", args: [agentId, uri] }),
    usdMicros: 0n,
    purpose: "ERC-8004 setAgentURI",
  });
  const after = await publicClient.readContract({ address: CONTRACTS.erc8004.identity, abi: identityAbi, functionName: "tokenURI", args: [agentId] });
  console.log(`${fork ? "fork tx" : txUrl(hash)}\nURI now: ${after}`);
});
