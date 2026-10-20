// Runs a TS CLI as a single esbuild bundle, rebuilt only when one of its inputs changed.
// Why: Node's ESM loader resolving hundreds of small files (viem, ox, zod) takes 7s+ on
// Windows; one bundled file starts in ~0.3s, which keeps `pnpm quote` under its 4s budget.
// Usage: node scripts/run.mjs <name> [...args]
import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENTRIES = {
  quote: "packages/router/src/cli/quote.ts",
  "verify-addresses": "scripts/verify-addresses.ts",
  "smoke-convert": "scripts/smoke-convert.ts",
  "deploy-receipts": "scripts/deploy-receipts.ts",
  "register-8004": "scripts/register-8004.ts",
  "reanchor-receipt": "scripts/reanchor-receipt.ts",
  "verify-receipt": "scripts/verify-receipt.ts",
  "grow-oracle": "scripts/grow-oracle.ts",
  "desk-feed": "scripts/desk-feed.ts",
  "desk-stitch-config": "scripts/desk-stitch-config.ts",
  "desk-fund": "scripts/desk-fund.ts",
  "desk-stitch": "scripts/desk-stitch.ts",
  "anchor-wallet": "scripts/anchor-wallet.ts",
  "deploy-guard": "scripts/deploy-guard.ts",
  "desk-rebalance": "scripts/desk-rebalance.ts",
  "fund-gas": "scripts/fund-gas.ts",
  "buy": "scripts/buy.ts",
};

const name = process.argv[2];
const entry = ENTRIES[name];
if (!entry) {
  console.error(`unknown CLI "${name}". Known: ${Object.keys(ENTRIES).join(", ")}`);
  process.exit(2);
}

const outDir = join(root, ".arbolito", "build");
const outfile = join(outDir, `${name}.mjs`);
const metaPath = join(outDir, `${name}.meta.json`);

function isStale() {
  if (!existsSync(outfile) || !existsSync(metaPath)) return true;
  const built = statSync(outfile).mtimeMs;
  const { inputs } = JSON.parse(readFileSync(metaPath, "utf8"));
  // Workspace sources are checked one by one; dependencies only change on install.
  const watched = [...inputs.filter((p) => !p.includes("node_modules")), "pnpm-lock.yaml"];
  return watched.some((p) => !existsSync(join(root, p)) || statSync(join(root, p)).mtimeMs > built);
}

if (isStale()) {
  const { build } = await import("esbuild");
  mkdirSync(outDir, { recursive: true });
  const result = await build({
    absWorkingDir: root,
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    outfile,
    metafile: true,
    logLevel: "warning",
    // Some CJS deps call require(); give the ESM bundle one.
    banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
  });
  writeFileSync(metaPath, JSON.stringify({ inputs: Object.keys(result.metafile.inputs) }));
}

// The CLI reads process.argv.slice(2); drop the CLI name so it sees only its own args.
process.argv.splice(2, 1);
await import(pathToFileURL(outfile).href);
