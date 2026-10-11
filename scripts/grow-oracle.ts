/**
 * pnpm grow:oracle <pool> <slots> [--live] [--yes]
 * Calls the permissionless Uniswap v3 `increaseObservationCardinalityNext(slots)` on a pool so
 * its TWAP history covers the session guard's 10-minute window (wBRL/USDT starts at 1).
 * Dry run by default: prints current cardinality, gas estimate and cost. --live sends via the
 * guarded sender (attribution, simulation; $0 value moved, gas only). Founder go-ahead required.
 */
import { encodeFunctionData, formatEther, parseAbi, type Address } from "viem";
import { POOLS, txUrl } from "@arbolito/config";
import { makePublicClient, makeWalletClient, sendGuarded } from "@arbolito/chain";
import { confirm, hasFlag, opsAccount, positional, runMain } from "./lib/cli";

const poolAbi = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function increaseObservationCardinalityNext(uint16 observationCardinalityNext)",
]);

runMain(async () => {
  const [poolArg, slotsArg] = positional();
  const pool = POOLS.find((p) => p.address.toLowerCase() === poolArg?.toLowerCase() || p.name.toLowerCase().startsWith(String(poolArg).toLowerCase()));
  const slots = Number(slotsArg);
  if (!pool || !Number.isInteger(slots) || slots < 2 || slots > 1200) {
    throw new Error("usage: pnpm grow:oracle <pool address | name prefix, e.g. wBRL/USDT> <slots 2..1200> [--live]");
  }
  const account = opsAccount();
  const publicClient = makePublicClient();
  const [, , , cardinality, next] = await publicClient.readContract({ address: pool.address as Address, abi: poolAbi, functionName: "slot0" });
  if (next >= slots) {
    console.log(`${pool.name}: cardinalityNext is already ${next} (≥ ${slots}). Nothing to do.`);
    return;
  }
  const data = encodeFunctionData({ abi: poolAbi, functionName: "increaseObservationCardinalityNext", args: [slots] });
  const [gas, gasPrice, balance] = await Promise.all([
    publicClient.estimateGas({ account, to: pool.address as Address, data }),
    publicClient.getGasPrice(),
    publicClient.getBalance({ address: account.address }),
  ]);
  console.log(`Grow ${pool.name} TWAP history on Celo mainnet
  pool              ${pool.address}
  cardinality now   ${cardinality} (next ${next}) → ${slots}
  gas estimate      ${gas}
  cost at ${(Number(gasPrice) / 1e9).toFixed(1)} gwei   ≈ ${formatEther(gas * gasPrice)} CELO
  from              ${account.address} (CELO ${formatEther(balance)})
  value moved       $0`);
  if (!hasFlag("live")) {
    console.log("\nDry run only. Re-run with --live after the founder approves.");
    return;
  }
  if (!(await confirm("\nThis sends a real Celo mainnet transaction (gas only).", "grow"))) {
    console.log("Aborted. Nothing was sent.");
    return;
  }
  const { hash, receipt } = await sendGuarded({
    mode: "live",
    live: true,
    publicClient,
    walletClient: makeWalletClient(account),
    to: pool.address as Address,
    data,
    usdMicros: 0n,
    purpose: `grow ${pool.name} oracle to ${slots}`,
  });
  const [, , , card2, next2] = await publicClient.readContract({ address: pool.address as Address, abi: poolAbi, functionName: "slot0", blockNumber: receipt.blockNumber });
  console.log(`\nSent: ${txUrl(hash)} (gas used ${receipt.gasUsed})\ncardinality ${card2}, cardinalityNext ${next2} (grows to it as new observations are written)`);
});
