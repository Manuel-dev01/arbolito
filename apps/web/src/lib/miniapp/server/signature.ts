import { verifyMessage, type Address, type Hex } from "viem";
import type { MiniappDeps } from "./deps";

/**
 * A personal_sign over `message` by `account`: plain EOAs (MiniPay) offline, smart accounts
 * through the chain (ERC-1271/6492). Used where the wallet must prove it's involved: turning a
 * rule on or off, and linking Telegram.
 */
export async function signedBy(deps: MiniappDeps, account: Address, message: string, signature: Hex): Promise<boolean> {
  try {
    if (await verifyMessage({ address: account, message, signature })) return true;
  } catch {
    /* not an EOA signature: try the chain */
  }
  try {
    return await deps.chain.verifyMessage({ address: account, message, signature });
  } catch {
    return false;
  }
}
