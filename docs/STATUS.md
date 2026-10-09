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
| Attribution code | **`celo_e054d92430a5`** (founder, 2026-10-09). Public by design (it is in every tx's calldata); set in `.env` |
| x402 attribution | Facilitator tagging is not live yet (x402-rs#99). Declare the builder-code extension now. **Judges credit x402 volume by `payTo`.** See [04-reference](04-reference.md#celo-x402-facilitator) |
| Ripio ramps | Deep links (`ramp.ripio.com`), no credentials needed. The full API is KYB, legal entities only. See [04-reference](04-reference.md#ripio-ramps-wfiat-onoff-ramp) |

## Infrastructure (2026-10-09)
| Piece | Where | State |
|---|---|---|
| Repo | https://github.com/Manuel-dev01/arbolito | **Private** for now; make it public before submission (founder's call). History scanned: no `.env` value appears in any commit |
| Web (Mini App, `/r/:id`, `/metrics`) | Vercel project `arbolito` (manuel-dev01s-projects), linked locally | Git connection and root dir `apps/web` deferred until `apps/web` exists, so a stub doesn't produce failing builds on every push |
| Postgres | Neon `arbolito-db` via Vercel marketplace (us-east-1, pooled) | `DATABASE_URL` set in `.env` and in Vercel env. No billing balance attached (free plan). Unreachable from the Claude sandbox until `*.neon.tech` is allowlisted |
| Bot / API hosting | Railway project `arbolito` (`e8a7b24e-50ec-4f14-88d5-7e93bf85a796`) | Empty; the first service deploys in Phase 2 |
| Desk wallet | `0xBCB8B7dcEB8B39457Ef6D5dC95520A562b13EdbE` (`DESK_PRIVATE_KEY`) | **Unfunded.** Inventory cap to be agreed first |
| Loops entry | CLI signed in (emmanuelolamiye@gmail.com). Event skill installed; criteria in [08-judging-criteria.md](08-judging-criteria.md) | **Assigned tag confirmed = `celo_e054d92430a5`** (dataSuffix matches ours byte for byte), so every mainnet tx so far counts. Enrolled (profile: Olamiye Emmanuel, Lagos, 18-24). **Entry creation paused by the founder (2026-10-09) to keep the repo private** (Loops cannot read a private repo via the CLI; the web form may support it). The approved draft text is ready. **Deadline: the entry, with a readable repo, ≥ 1 screenshot and a demo URL, must exist by 2026-11-09 09:00 UTC.** No project yet, `agent-wallet` unset, no ERC-8004 identity yet |

## Decisions
- **2026-10-09: LLM provider is DeepSeek, not Anthropic** (founder). `LLM_PROVIDER=deepseek`, OpenAI-compatible API at `https://api.deepseek.com`, models verified via `GET /models` on 2026-10-09: **`deepseek-flash`** (agent: fast, cheap) and **`deepseek-v4-pro`** (risk officer). The older names `deepseek-chat`/`deepseek-reasoner` are not served. This supersedes the Claude models in MASTER_PROMPT §2. Voice notes use Groq `whisper-large-v3-turbo` (key verified). Telegram bot: **@arbolitoo_bot** (token verified via getMe).

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
- [x] Mainnet BRL→ARS conversion with a verified receipt. **Done 2026-10-09:** 10 wBRL → 3,177.4119 wARS (exactly as quoted), +524 bps vs official BRL/ARS. Swap [`0xa8a3c639…71b7`](https://celoscan.io/tx/0xa8a3c6399979525de3706127a183b9e87d9f7e24a3b2626a7e88c5deccac71b7), receipt anchored [`0x83bbf7a6…1263`](https://celoscan.io/tx/0x83bbf7a6fd68ca0b0bfd632b931b80fbc078b3dc00ff0125ac0eee3772f91263). `pnpm verify:receipt docs/receipts/bf28b8ab-31a9-4679-8028-bcb471f7d980.json` returns OK.
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
### 2026-10-09: Textile-leg execution (`executeRoute`), no mainnet sends
**Shipped:**
- **`packages/router/src/executor.ts`:** `executeRoute` runs routes leg by leg. Every send goes through `sendGuarded`.
  - Consecutive Uniswap legs run as one atomic swap, sized to what the previous step actually delivered (from Transfer logs).
  - Each Textile leg takes a firm RFQ for that exact amount. Before anything is broadcast, it checks the bound taker, `sellAmount`, `takerPays ≤ input`, spender and swap target equal to the verified LimitOrderReactor, chainId and value, `buyAmount ≥ leg.minOut`, and `expiresAt` with a 15 s margin (checked again after the approve). Any failure cancels the RFQ.
  - It approves exactly `takerPays` with its own calldata (not the API's), sends `transactions.swap`, then calls `/submit` with the hash. If `/submit` fails, it reads the status and records both, with no retry. On a fork it cancels instead of submitting.
  - A failure stops the route and returns `partial` or `failed`, with every tx, the error and the exact holding. An unconfirmed swap is looked up onchain once. If it is still unknown, the holding is marked uncertain and shows both possible outcomes; the swap is never re-sent or cancelled.
  - The route's USD value is charged to the caps once, on the first value-moving send.
- **`sendGuarded`:** throws `BroadcastError {hash, outcome: reverted | unconfirmed}` after broadcast.
- **`executableRoutes(..., { textileFirm: true })`** returns Uniswap+Textile RFQ routes. It never returns other venues.
- **`pnpm smoke:convert`:** runs via `executeRoute` and picks Textile routes only when `TEXTILE_RFQ_ENABLED=true`. A partial run prints the txs and the holding, saves `<routeId>.execution.json` and anchors no receipt.
- **Tests:**
  - Unit: 73 pass, 18 of them new (mocked clients and Textile).
  - Fork: 11 pass. The new Uniswap→Textile run uses `MockRfqReactor` etched at the reactor address, because firm quotes can't be fetched for fork wallets.

**Not yet exercised:** a real firm Textile fill on mainnet. That needs a founder go-ahead and a funded taker. Note that `--fork` with `TEXTILE_RFQ_ENABLED=true` takes a **real** firm quote, which locks maker inventory and is cancelled after the fork fill.

### 2026-10-09: Phase 1 mainnet smoke (founder go-ahead; ops wallet `0x7e0316b2533F6dF2E651295A9B11481BB8346c3c`)
Funded by the founder with 6.9 USDT + 2.73 CELO. `verify:addresses` 68/68 before any send. Every tx carries `celo_e054d92430a5`.

| # | Action | Tx | Result |
|---|---|---|---|
| 1 | Deploy ArbolitoReceipts | [`0xd3e1a5f6…421a`](https://celoscan.io/tx/0xd3e1a5f6585c19d13d89491b47f597ed9b61f77fd074c9c14b86c30162ba421a) | `0x5C0b…2d34`. Owner and emitter are the ops wallet; attribution suffix confirmed in the initcode |
| 2 | approve USDT | [`0x3564c91c…0fd5`](https://celoscan.io/tx/0x3564c91cbc427e957a9c2376f7cb3ccb17186de1f4310246f14d2ae616750fd5) | |
| 3 | 2.5 USDT → wBRL (Uniswap) | [`0x43ab6cca…e743`](https://celoscan.io/tx/0x43ab6ccad6b56d72e76cdfba312b7f42923016da8d361eb26aba9da23f5ee743) | 12.647118 wBRL, exactly as quoted |
| 4 | Receipt #1 anchor (**flawed**) | [`0x741eba2d…6d6a`](https://celoscan.io/tx/0x741eba2d59e19642f1afaca5c8bde7b05eeeee2947f5d71478539b0656fa6d6a) | Recorded amountOut 0. Kept as `.superseded.json`; now fails verify |
| 5 | Receipt #1 corrected | [`0xbda9ac2c…4255`](https://celoscan.io/tx/0xbda9ac2ca3ad520a87a2db6fdd2a7c3fbb0f0af1882d14f0a7877f9aad4b4255) | verify OK |
| 6 | approve wBRL | [`0x3ad763ab…d2ef`](https://celoscan.io/tx/0x3ad763ab5e73436f85b4b4d1c4c032b3720f65a29c418dba887287f5ce90d2ef) | The swap that followed failed simulation (`STF`, lagging node) and was **never broadcast** |
| 7 | **10 wBRL → wARS** (Uniswap, 2 hops) | [`0xa8a3c639…71b7`](https://celoscan.io/tx/0xa8a3c6399979525de3706127a183b9e87d9f7e24a3b2626a7e88c5deccac71b7) | **3,177.4119 wARS**, exactly as quoted; +524 bps vs official |
| 8 | Receipt #2 anchor | [`0x83bbf7a6…1263`](https://celoscan.io/tx/0x83bbf7a6fd68ca0b0bfd632b931b80fbc078b3dc00ff0125ac0eee3772f91263) | verify OK |

- **Spend:** the cap ledger counts $4.48 of the $25 day; gas was 0.195 CELO for 8 txs.
- **Balances after:** 4.4 USDT, 2.647 wBRL, 3,177.41 wARS, 2.536 CELO.
- **Two production bugs, both caused by forno being load-balanced (read-after-write lag), both fixed:**
  1. The amount was measured from balance diffs and read 0. Executed amounts now come from the swap's Transfer logs, and `verifyBundle` rejects a bundle whose amountOut differs from what the tx delivered. Fork regression test added.
  2. Simulating right after an approve reverted. Simulation now retries read-only and passes its gas estimate to signing; the smoke script skips an approve when the allowance already covers the swap.
- **Textile:** the best route was Textile→Uniswap, but firm Textile execution is still opt-in, so the best executable all-Uniswap route ran.

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
- **Mainnet smoke:** done (see the 2026-10-09 mainnet smoke entry above).
- **Identity:** ERC-8004 registration and Self Agent ID wait on a domain (`PUBLIC_BASE_URL`), a bot handle and the go-ahead.
- **Decision:** whether to run `npx loopshouse add agents-on-open-rails`.
- **Untracked file:** `AGENTS.md` is the founder's file and is left uncommitted. Its "Codex-api" skill reference came from a find-and-replace of "Claude" and should probably read `claude-api`.

**Next:** the Phase 2 plan (proposed in the session report). Re-map the roadmap to the 11-09 deadline. Read the official track rules first.

### 2026-10-06
- Project pack created: README, CLAUDE.md, PLAN.md, MASTER_PROMPT.md, docs 01–06, .env.example.
- Next: Day 0 checklist, then run MASTER_PROMPT.md to start Day 1.
