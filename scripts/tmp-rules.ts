// Temporary read-only probe (deleted after use): rules and their runs.
import { loadEnv } from "@arbolito/config";
import { getDb, ruleRuns, rules } from "@arbolito/db";

const env = loadEnv() as unknown as Record<string, string | undefined>;
try {
  const db = getDb(env.DATABASE_URL!);
  const rs = await db.select().from(rules);
  const runs = await db.select().from(ruleRuns);
  for (const r of rs.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    console.log(`R ${r.id.slice(0, 8)} ${r.account.slice(0, 6)}…${r.account.slice(-4)} ${r.kind} ${r.status} created=${r.createdAt.toISOString()} confirmed=${r.confirmedAt?.toISOString() ?? "-"} next=${r.nextRunAt?.toISOString() ?? "-"} stopped=${r.stoppedReason ?? "-"} params=${JSON.stringify(r.params, (_k, v) => (typeof v === "bigint" ? v.toString() : v)).slice(0, 260)}`);
    for (const u of runs.filter((x) => x.ruleId === r.id)) console.log(`R   run ${u.trigger} ${u.status} in=${u.amountIn} out=${u.amountOut} txs=${JSON.stringify(u.txHashes)} err=${u.error ?? "-"} at=${u.createdAt.toISOString()}`);
  }
  console.log(`R now ${new Date().toISOString()} rules=${rs.length} runs=${runs.length}`);
} catch (e) {
  const err = e as Error & { cause?: Error };
  console.log("R ERR", err.message.slice(0, 120), "| cause:", err.cause?.message ?? String(err.cause));
}
process.exit(0);
