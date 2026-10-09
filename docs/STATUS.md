# STATUS: progress log

Update at the end of every work block: what shipped, what's blocked, what's next. Newest entry on top.

## Hackathon facts (fill in as confirmed)
| Item | Value |
|---|---|
| Kickoff | 2026-10-06 12:00 GMT |
| Deadline | **2026-11-09** (founder, 2026-10-07; time/timezone TBD). Window is ~33 days, not the 10 PLAN.md assumed |
| Official track rules | Published 2026-10-08. **Read them before locking scope** |
| T1 (Ripio, "Stable Agents LatAm") | $2K: 🥇 $1.5K, 🥈 $500. "Build a solution a real user in Latin America would pay to use." Judged on **functionality, UX, impact, innovation, verified onchain wFIAT use** |
| Hub / submission form | TBD. Organizers also offer an agent skill: `npx loopshouse add agents-on-open-rails` (installs the loops CLI and an `.agents` skill, plus a browser sign-in). Founder to decide/run |
| Multi-track eligibility | TBD |
| Attribution code | TBD. Note that `@celo/attribution-tags` exports `codeFromRepo()` / `codeFromHostname()`, so codes may be derived from the repo slug. Ask organizers |
| x402 attribution | Facilitator tagging is not live yet (x402-rs#99). Declare the builder-code extension now. **Judges credit x402 volume by `payTo`.** See [04-reference](04-reference.md#celo-x402-facilitator) |
| Ripio ramps | Deep links (`ramp.ripio.com`), no credentials needed. The full API is KYB, legal entities only. See [04-reference](04-reference.md#ripio-ramps-wfiat-onoff-ramp) |

## Day 0 checklist
- [ ] Textile email sent ([draft](06-outreach-drafts.md#1-textile-api-key-and-filler-onboarding)). **Less critical now:** taker paths are keyless and maker enrollment is self-serve (`/v2/maker/enroll`). Still ask how "quoted volume" is measured.
- [ ] x402.celo.org API key
- [ ] `npx @celo/buy setup` done; ~$10 USA₮ funded; 1 browser session + 1 X search tested
- [ ] Ops wallet funded; test swaps into wARS and wBRL done (record slippage below)
- [ ] Telegram bot handle reserved; domain reserved
- [ ] Kickoff questions asked ([draft](06-outreach-drafts.md#2-kickoff-questions-for-organizers))

## Phase 1 exit criteria
- [x] `pnpm verify:addresses` green: **67/67** at block 79491985. It covers tokens, pools (+ `factory.getPool`), periphery `factory()`, fee adapters vs FeeCurrencyDirectory, and code presence.
- [~] `pnpm quote wBRL wARS 200`: best route + alternatives + references. **2.3–2.6 s** measured from process start with 6 quotes (Uniswap + Textile previews). Wall time via `pnpm` is 4.0–4.2 s, because pnpm's own startup on Windows adds ~1.6 s; `node scripts/run.mjs quote …` is ~2.6 s. On a degraded network the Textile and dolarapi timeouts (1.5 s each) bound it.
- [x] Fork e2e passes in `pnpm test`: 10 forge + 63 vitest, including 8 fork e2e tests (wBRL→wARS executed, receipt anchored, verified; tampered and foreign-emitter bundles rejected).
- [ ] Mainnet BRL→ARS conversion with a verified receipt. **Deferred, pending the founder:** no `OPS_PRIVATE_KEY`, no funds, no `ATTRIBUTION_CODE`, no go-ahead yet. The script is ready and rehearsed on a fork (see log).
- [x] Spikes "Textile v2 taker flow" and "smart-account taker" have written findings and decisions (below).
- [x] STATUS updated with evidence.

## Spikes
| Spike | Status | Finding | Decision |
|---|---|---|---|
| Textile v2 taker flow | **done** | From `openapi-v2.json`: preview is keyless and free. A firm `/rfq/request` is keyless with `takerProof` (EIP-712 TakerControl), checks proof of funds and returns `transactions.{approval,swap}`. **The taker broadcasts** (approve `quote.spender`, then `swap` = reactor `executeBatch`), then reports to `/rfq/{id}/submit` with the `X-Rfq-Claim` header. The reactor is UniswapX `LimitOrderReactor` (verified onchain). Live previews priced both USDT legs. | Textile previews compete in the planner now (best wBRL→wARS today is Textile→Uniswap, +44 bps vs all-Uniswap). Firm quotes and Textile-leg execution are built in `TextileClient` and gated by `TEXTILE_RFQ_ENABLED` until a funded taker runs them on mainnet. No partner key is needed. |
| Smart-account taker vs Textile/Permit2 | **done** | **API:** takerProof accepts EIP-1271 *and* counterfactual ERC-6492 smart accounts (Safe, 4337). **Onchain:** an RFQ taker is just `msg.sender` of `executeBatch`, so any account type can settle. For gasless limit orders the user is the *swapper*: `contracts/test/fork/TextileReactorSmartAccount.t.sol` executes a LimitOrder signed by an EIP-1271 contract wallet on Textile's deployed reactor, and rejects a foreign signature (2/2 pass on a Celo fork). Caveat: Permit2 verifies 1271 only for *deployed* accounts (no 6492), so deploy before the first limit order. | Keep the default: smart accounts plus scoped session keys (thirdweb). Deploy the account at onboarding. No 7702 or EOA fallback needed for Textile. |
| Stitch headless + custom feed | open | Maker enrollment is self-serve via `/v2/maker/enroll` (wallet signature). | Phase 2 |
| buy browser session control | open | | Phase 3 |
| x402 permit2 assets seller config | open | Builder-code extension: see 04-reference | Phase 3 |

## Log
### 2026-10-09: Phase 1 build block (steps 1–9)
**Shipped (commits `cda1065`…):**
- **Scaffold:** pnpm monorepo (apps/agent, fx-api, mcp, desk, web; packages/config, chain, router, proof, buy-client, x402, db, llm), strict TS, Vitest unit and fork projects, Foundry + forge-std, zod env schema (a test keeps it in sync with `.env.example`). Added [07-keys-setup.md](07-keys-setup.md).
- **`packages/config` + `pnpm verify:addresses`:** 67/67 green. New verified facts recorded in 04-reference: QuoterV2 `0x8282…a8E8`, SwapRouter02 `0x5615…abc4`, fee adapters for USDT `0x0E2A…6f72` and USDC `0x2F25…602B` (from FeeCurrencyDirectory), cNGN 6 decimals, onchain symbols `USAT` and `USD₮`, Multicall3.
- **`packages/chain`:** `sendGuarded` is the single send path.
  - **Mode checks:** fork mode talks only to anvil; live mode needs `--live`, chainId 42220 and a real `ATTRIBUTION_CODE`.
  - **Caps:** per-action and daily caps are checked **before signing**, with reserve-then-settle ledger entries.
  - **Every tx:** gets the ERC-8021 suffix, deploys included, and is simulated first.
  - Fee currency resolves 6-decimal stables to their adapters.
- **`packages/router`:**
  - Uniswap v3 adapter (QuoterV2, pinned block).
  - Textile v2 client and preview adapter.
  - Planner: direct + 2-hop via USDT across venues, exact chained amounts, alternatives and every quote kept.
  - References: dolarapi USD/ARS official/MEP/CCL/crypto/blue, BRL/ARS official, Uniswap mids, Textile mids.
  - `pnpm quote` runs as a cached esbuild bundle. Node's ESM loader took 7–17 s to boot viem on this Windows machine.
- **`packages/proof` + `ArbolitoReceipts.sol`:**
  - **Contract:** emitter allowlist, anchor-once, `anchoredAt`. 10 forge tests, including a fuzz test and a deploy with a trailing attribution suffix.
  - **Bundle:** zod v1 schema, RFC 8785 canonical JSON, keccak256, savings vs official.
  - **Verifier:** checks the hash is anchored, the log's routeId and emitter, and the execution tx's success, block and attribution.
- **Fork e2e** (`packages/proof/test/e2e.fork.test.ts`):
  - **Money path:** 200 wBRL→wARS executed through `sendGuarded`, receiving exactly `expectedOut`. The default $5 cap refuses the swap; it runs under an explicit fork cap.
  - **Receipt:** bundle anchored, `verifyBundle` OK; a tampered bundle and a foreign emitter are rejected.
- **Mainnet smoke tooling:** `pnpm deploy:receipts` and `pnpm smoke:convert`. Both are dry-run by default, `--live` for mainnet (typed confirmation), and `--fork` for rehearsal. **Rehearsed on a fork:**
  - deploy `0xac47…4a3a`
  - 10 wBRL ($1.98) → 3,173.9887 wARS, exactly as quoted
  - bundle `0x9880…a649` anchored, `verifyBundle: OK`, +513 bps vs official BRL/ARS
- **Identity prep (not executed):** `identity/agent-registration.template.json` (ERC-8004 registration-v1: `services`, `x402Support: true`); `pnpm register:8004` (render, simulate, `--live`), with `register(string)` confirmed by eth_call simulation; [identity-steps.md](identity-steps.md) with the Self Agent ID CLI (`--network mainnet`; it defaults to testnet).

**Fixed along the way:**
- **Process exit:** the CLIs called `process.exit()`, which tripped a libuv assertion on Windows. They now exit via `exitCode` plus an unref'd timer.
- **Fork test hang:** anvil's on-demand mining raced viem's receipt watcher and hung the fork suite intermittently. anvil now runs with `--block-time 1`.

**Blocked on the founder:**
- **Mainnet smoke:** needs `OPS_PRIVATE_KEY` funded with ~10 wBRL + gas, a real `ATTRIBUTION_CODE`, and an explicit go-ahead. Order: `pnpm deploy:receipts` (dry), `--live`, set `CONTRACTS.arbolitoReceipts`, then `pnpm smoke:convert wBRL wARS 10 --live`.
- **Identity:** ERC-8004 registration and Self Agent ID wait on a domain (`PUBLIC_BASE_URL`), a bot handle and the go-ahead.
- **Decision:** whether to run `npx loopshouse add agents-on-open-rails`.
- **Untracked file:** `AGENTS.md` is the founder's file and is left uncommitted. Its "Codex-api" skill reference came from a find-and-replace of "Claude" and should probably read `claude-api`.

**Next:** the Phase 2 plan (proposed in the session report). Re-map the roadmap to the 11-09 deadline. Read the official track rules first.

### 2026-10-06
- Project pack created: README, CLAUDE.md, PLAN.md, MASTER_PROMPT.md, docs 01–06, .env.example.
- Next: Day 0 checklist, then run MASTER_PROMPT.md to start Day 1.
