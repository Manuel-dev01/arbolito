// Temporary read-only check (deleted after use): do our transactions end with the exact ERC-8021 suffix Loops expects?
import { type Hex } from "viem";
import { makePublicClient } from "@arbolito/chain";

const LOOPS_SUFFIX = "63656c6f5f653035346439323433306135110080218021802180218021802180218021";
const c = makePublicClient();
const txs: [string, Hex][] = [
  ["ops → desk 40 USDT (10-26)", "0x5588598d4d4c9307f4a7d4b0e9319f12bac06366ecfb593198a4f126eebc2c7c"],
  ["desk wARS approve (10-27)", "0xa3deeacf34aec7371c4d51085e810e0f3095bae4d871e1e62284b1757c48dfbf"],
  ["receipt execution swap (10-20)", "0xdf5ba1411d22e92eef19ba7d5e4e0dca5463563ed8d7d39db9094c6c6e89eab9"],
  ["ERC-8004 register (ops)", "0xbb465125" as Hex],
];
for (const [label, h] of txs) {
  if (h.length !== 66) {
    console.log(`S ${label}: hash not full, skipped`);
    continue;
  }
  try {
    const tx = await c.getTransaction({ hash: h });
    const input = tx.input.toLowerCase().slice(2);
    const tail = input.slice(-LOOPS_SUFFIX.length);
    console.log(`S ${label}: from ${tx.from} ends with Loops suffix: ${tail === LOOPS_SUFFIX}${tail === LOOPS_SUFFIX ? "" : ` (tail ${input.slice(-80)})`}`);
  } catch (e) {
    console.log(`S ${label}: ${(e as Error).message.split("\n")[0]}`);
  }
}
process.exit(0);
