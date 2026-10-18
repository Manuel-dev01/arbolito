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
| Web (Mini App, `/r/:id`, `/metrics`) | **https://arbolito-livid.vercel.app** (Vercel project `arbolito`, root `apps/web`, Next.js 16.4) | **Public** (founder, 2026-10-09). Git-connected: pushes to `main` deploy to production. Vercel Authentication turned off so the production URL isn't behind a login. First deploy `dpl_D2U8uhBT9HDwTLpKQoj7CzzEgjRB` (commit `6b1195c`) READY. `PUBLIC_BASE_URL` set. Not reachable from the Claude sandbox until `*.vercel.app` is allowlisted |
| Postgres | Neon `arbolito-db` via Vercel marketplace (us-east-1, pooled) | `DATABASE_URL` set in `.env` and in Vercel env. No billing balance attached (free plan). Unreachable from the Claude sandbox until `*.neon.tech` is allowlisted |
| Bot / API hosting | Railway project `arbolito` (`e8a7b24e-50ec-4f14-88d5-7e93bf85a796`), service **`arbolito-bot`** | **Live** (2026-10-11), long polling as @arbolitoo_bot; private beta `TELEGRAM_ALLOWED_USERS=@ola_nuell`. Built from `Dockerfile.bot` (via `RAILWAY_DOCKERFILE_PATH`; Railpack failed on pnpm 11). Deployed from a clean `git archive` snapshot with `railway up`, because GitHub auto-deploy isn't connected (Railway's GitHub app likely lacks access to the private repo). 20 env vars, least privilege: **no private keys** on Railway |
| Desk wallet | `0xBCB8B7dcEB8B39457Ef6D5dC95520A562b13EdbE` (`DESK_PRIVATE_KEY`) | **Unfunded.** Inventory cap to be agreed first |
| Loops entry | CLI signed in (emmanuelolamiye@gmail.com). Event skill installed; criteria in [08-judging-criteria.md](08-judging-criteria.md) | **Assigned tag confirmed = `celo_e054d92430a5`** (dataSuffix matches ours byte for byte), so every mainnet tx so far counts. Enrolled (profile: Olamiye Emmanuel, Lagos, 18-24). **Entry creation paused by the founder (2026-10-09) to keep the repo private** (Loops cannot read a private repo via the CLI; the web form may support it). The approved draft text is ready. **Deadline: the entry, with a readable repo, ≥ 1 screenshot and a demo URL, must exist by 2026-11-09 09:00 UTC.** No project yet, `agent-wallet` unset, no ERC-8004 identity yet |

## Decisions
- **2026-10-11: MiniPay is the primary surface; the wallet architecture is MiniPay-native** (founder). Supersedes the smart-accounts and session-keys decision of 2026-10-09.
  - **Why MiniPay:** it's live as a standalone app in AR, BR, CL, CO, PE, UY and MX (and NG), with 7M+ activations and 50M+ weekly Discover impressions. It's Celo's flagship distribution, and MiniPay apps are the first priority of the attribution-tags SDK.
  - **Users are MiniPay EOAs.** There are no sign-in screens; the wallet is injected and auto-connects.
  - **User-initiated** convert, send and Textile fills are signed by the user's own MiniPay wallet. That also satisfies Textile's taker-exclusive fills.
  - **Autonomous** rules run through **ArbolitoGuard v2**: a bounded ERC-20 allowance plus a revocable **operator**, with config only by the account's own transactions, Uniswap only.
  - **Telegram stays as a second channel:** chat, voice, quotes, receipts, notifications. Its Confirm becomes "Confirm in MiniPay", a deep link to the mini app at that pending action. Each Telegram user links their MiniPay wallet once.
  - The thirdweb smart-account and session-key code (`packages/chain/src/smartAccount.ts`, guard v1) stays in the repo as a verified alternative but is not used.
  - **To verify inside MiniPay (Developer Mode):** whether the attribution suffix survives in MiniPay-sent txs, whether `feeCurrency` gets overridden, whether `eth_signTypedData`/`personal_sign` work for Textile's one-time takerProof (eip191 fallback), and how to prove wallet ownership for Telegram linking without auth-style message signing.
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
| Smart accounts + session keys (self-bundled) | **done** | The fork spike (25 fork tests green on main) shows the relayer EOA can submit zero-fee UserOps for thirdweb v0.6/v0.7 accounts with no bundler or paymaster. Onboarding is one op (deploy + approve + grant); grants and revokes are gasless. Session keys are target-scoped only, so a key scoped to a router can send tokens to arbitrary recipients (`exactInputSingle` recipient, `sweepToken`). | **Founder chose smart accounts.** Close the router gap with an Arbolito guard contract as the only session-key target (hard-coded recipient = account, token allowlist, account-set caps, minOut floor). Relayer: fresh plain EOA with a capped CELO float, simulating before every send. Tag both outer and inner calldata. |
| Stitch headless + custom feed | open | Maker enrollment is self-serve via `/v2/maker/enroll` (wallet signature). | Phase 2 |
| buy browser session control | open | | Phase 3 |
| x402 permit2 assets seller config | open | Builder-code extension: see 04-reference | Phase 3 |

## Log
### 2026-10-18: Risk officer live; wCOP/wMXN priced (dry)
- **Desk fills:** 3 so far, all on wBRL from taker `0x5dc2…b77f`: a sale at +6 bps, then two buys totalling $20 at +2 bps (the raised buy cap at work). NAV $79.95 vs $80 funded.
- **Risk officer on** (founder go-ahead):
  - `DEEPSEEK_API_KEY` (copied via stdin) and `DESK_RISK_OFFICER=true` set on `desk-feed`.
  - DeepSeek V4 thinks by default: with a 3,000-token budget it reasoned without answering, and it rejects a forced `tool_choice`. Now called with `thinking: disabled` (new llm client option) and the decide tool forced, about 930 tokens per review. A text-JSON fallback is kept.
  - First live review: all six corridors normal, with reasons.
- **wCOP/USDT and wMXN/USDT** (not live, priced only):
  - **Sources:** Textile `/tickers` maker levels, ExchangeRate-API (daily; attribution needed when shown) and the ECB via Frankfurter (MXN).
  - **Live:** COP 3,174.37 (sources within 27 bps); MXN 18.4655 (within 44 bps).
  - Stitch, funding and `/desk` only include live corridors.
- **Next:**
  - Founder runs `/minipay-check`.
  - Fund wCOP/wMXN: about 40 USDT. No Uniswap pools exist, so swaps go via Textile with our partner key (first live Textile taker execution; rehearse on a fork).

### 2026-10-17: Desk on four corridors; app conversions routed through Textile
**Shipped:**
- **Organisers confirmed:** our app's users filling against the desk is not self-trading.
- **Textile partner API key** (founder-created, live): set on Vercel as `TEXTILE_API_KEY` with `TEXTILE_RFQ_ENABLED=true`. Firm quotes for MiniPay users need no extra user signature. `ATTRIBUTION_CODE` was missing on Vercel, which left /prepare `not_ready`; now set.
  - **Verified:** the live `/api/miniapp/quote` for 5 USDT → wARS routes via Textile at 8,082.7 wARS (Uniswap 8,040.0).
- **Desk corridors:**
  - **New:** USDC/USDT and USA₮/USDT, at US$ 10 per side and 3/3 bps spreads. They price off Textile with a fixed 1.00 peg as the second source, so a drift of more than 30 bps off peg trips the breaker (depeg guard).
  - **wBRL:** buy cap raised to US$ 20, using idle USDT.
- **Inventory** (founder sent another 40 USDT): 2 × 5 USDT → 9.987 USDC through the new Uniswap USDC/USDT 0.01% pool (`0x1a810e0B…8846`, verified, added to config and 04-reference), and 2 × 5 USDT → 10.0015 USA₮. Approvals in place; all txs tagged.
- **Stitch** quotes four pools; `/desk` shows all four.
- **Hygiene:**
  - Guard constructor pools are now an explicit `guard` flag, so a new routing pool never changes a guard deploy.
  - Textile client tests no longer read the key from `.env`.
  - Migration 0003 adds snapshot columns `usdc`, `usat` and `fairs`.
- **Textile day-one email:** 1 quote sent, 1 filled. Flow is the constraint, not price.

**Risks / next:**
- The firm path with the partner key (/prepare → MiniPay) hasn't run end to end with a real user yet. The founder's `/minipay-check` is still pending.
- Risk officer: turn on at ≥10 fills or after 3 days live.
- Consider wCOP/wMXN corridors (they need COP and MXN price sources).

### 2026-10-15: Landing matches the design; Arbolito Desk feed built and dry-run against Stitch
**Shipped (pushed to main):**
- **Landing:**
  - three.js coins follow the design's waypoints (y up, half-viewport units), turn over with the scroll (US$ on edge at the footer) and tint lavender to sage, with a hover lean and flick
  - light "mix" skin everywhere
  - live "Recibís · vence en 48 s" hero card
  - the design's two illustrations, with the screenshot UI removed from the trust one
- **Organiser guidance** recorded in 04-reference:
  - **x402:** credit goes by `payTo` address; attribution tags aren't supported yet.
  - **buy:** list the services used, with proof of payment.
  - **Textile:** maker keys come from Stitch; vaults are beta.
- **Desk scope** (docs/10-desk-plan.md): Stitch, unmodified, as the executor; our feed as the strategy.
- **`apps/desk`:**
  - **Feed:** multi-source weighted median with outlier rejection, a per-direction inventory skew that never crosses fair, and a circuit breaker that holds the old timestamp so Stitch stops quoting.
  - **Tooling:** `pnpm desk:feed` (`/feed/<pair>`, `/state`, `/healthz`), `pnpm desk:stitch-config`, 19 unit tests.
  - **Spreads:** devaluation-aware wARS spreads (14 bid / 5 ask, wARS target 30%) and wBRL 6/6. The competition is Stitch's ±1 bps template.
  - **Verified:**
    - a live read-only tick gave wARS 1,612.5 and wBRL 5.051
    - Stitch v0.1.312 `--dry-run`, with a throwaway key, parsed our config and read both feeds; nothing was signed or sent
- **Totals:** 378 vitest unit tests passing (1 skipped); tsc clean.

**Desk set up later the same day (founder sent 40 USDT; gas from ops):**
- **Inventory, onchain:** 20 USDT, 16,115.43 wARS (2 × 5 USDT on Uniswap) and 50.55 wBRL (2 × 5 USDT), all txs tagged. Bounded Permit2 approvals: 40 USDT, 32,000 wARS, 100 wBRL.
- **Gas:** 0.27 CELO from ops; mainnet gas was 202.5 gwei.
- **Incident, nothing lost:** the first live run stopped before swap 3. A lagging node reported an allowance the previous swap had spent, so the approve was skipped and the swap failed simulation (`STF`) and was never sent. Fixed in `executeRoute`: allowance reads must be at or after the last confirmed block. A test reproduces the lag.
- **Textile:** registered as maker `stitch-42220-bcb8b7dc` with `pnpm desk:stitch connect`. The confirmation link went to the founder's email. The credential is kept in `.arbolito/stitch/` (gitignored).

- **Desk live on Railway:**
  - `desk-feed` serves https://desk-feed-production.up.railway.app.
  - `desk-stitch` runs Stitch v0.1.312, pinned to `sha-109ed6e`.
  - The RFQ session is accepted (LIVE).
- **First fill:** sold 49.995 wBRL for 9.8677 USDT to an independent taker, tx `0x27d4ee67…`, at mid + 6 bps. See docs/10-desk-plan.md, including the honest P&L note (the inventory was bought on the thin Uniswap pool).
- **Cleanup:** the accidental Railway project `snap-desk-feed` was deleted with the founder's OK. Deploys now always pass `--project/--environment/--service`.
- **Ledger (migration 0002):** `desk_fills`, `desk_snapshots` and `desk_state` in Neon. The feed service indexes the desk wallet's transfers every tick. A fill is a tx someone else sent that moves the soft asset and USDT in opposite directions; it is recorded with the fair price of the moment. Inventory and NAV snapshots run every 5 min.
  - The first fill's fair price was recovered from Stitch's tick log: edge +6.00 bps.
  - First NAV: $39.957 vs the $40 funded.
- **Live `/desk` page:**
  - per-corridor quoting status (fair, skew, our bid and ask, sources, breaker reason)
  - fills with edge vs fair and tx links
  - inventory at fair, and P&L vs the 40 USDT funded
  - the strategy in plain words
  - The landing's desk tile shows the real fill count.
- **Risk officer:** `apps/desk/src/risk.ts`. An LLM reviews hourly signals (move, volatility, dispersion, holds, fills, average edge, inventory) every 15 min. It can only pause a corridor for 15–120 min, clamped in code; malformed output or a failed call does nothing. Off by default (`DESK_RISK_OFFICER`).
- **Totals:** 388 vitest unit tests passing (1 skipped).

**Next:**
- Founder decision: enable the risk officer on Railway (needs `DEEPSEEK_API_KEY` on `desk-feed`; ~100 calls/day).
- Watch fill quality: if edge goes negative, widen spreads.
- Rebuild wBRL inventory at fair (the bid side does this on its own).
- **Hosting:** a Railway service for the feed and Stitch.
- **Organisers:** ask whether our app's users filling against our desk counts as self-trading.

**Next:** with approval, fund the desk wallet; send exact Permit2 approvals through `sendGuarded` (tagged); connect and go live at small caps. Then the fills indexer, P&L ledger and the live `/desk` page.

### 2026-10-12: Design implemented end to end (Mini App, backend, public site, bot)
**Shipped (merged to main, pushed; Vercel deploys from main):**
- **Telegram bot:** HTTP quotes from the web API, "Confirmar en MiniPay" links, self-editing cards and `/conectar` wallet linking. LLM copy updated so money moves only when the user confirms in MiniPay.
- **Mini App backend** (`/api/miniapp/*`): rates, balances, quote, quotes/open, prepare (with Textile `needs_taker_proof`), reject, submit (checks the sender, calls and attribution tag; `amountOut` from Transfer logs), receipt, autonomy status/plan/revoke-plan, chat (voice included), link/confirm. Also `/minipay-check` diagnostics.
- **Mini App UI** (`/app`, `/app/link`): every design state, MiniPay auto-connect, stablecoin `feeCurrency` adapters, "No sabemos si se completó" on uncertain sends (never retries), demo mode only with `?mock=1`.
- **Public site:** redesigned landing (live calculator, in-browser fingerprint check), receipt story page, metrics, and a `/desk` placeholder, in es/pt/en.
- **Totals:** tsc clean, 359 vitest unit tests passing (1 skipped), web build green.

**Blocked on the founder:**
- Run `/minipay-check` in MiniPay Developer Mode. Submit rejects txs whose attribution tag MiniPay changes or strips, so this decides whether real submits work.
- Vercel env vars: `ATTRIBUTION_CODE` (without it prepare and autonomy return `not_ready`), `DEEPSEEK_API_KEY` and `STT_API_KEY` for chat. Anchoring stays off until a funded anchor wallet is approved.
- Guard v2 mainnet deploy (≈3.04M gas). MiniPay Discover listing (name, URL, 512×512 icon).

**Open risks:**
- The Textile eip191 proof text is unconfirmed against the live API, and the 12-hour grant is probably IP-bound. Keep `TEXTILE_RFQ_ENABLED=false` for MiniPay users.
- The `account` field is unauthenticated; anyone can name any wallet, but nothing can move money. A wallet-signature proof on reject and link is still TODO.
- Rate limits are in-memory, per server instance.
- Nothing re-anchors receipts left `registering`.

**Contract gaps flagged by the UI** (`TODO(contract)`): send-to-contact prepare, `GET /quote/:id`, instant autonomy pause, receipts list, phone → address lookup, no-market notify, in-app withdraw, link status.

**Next:** close the send-to-contact and receipts-list gaps, redeploy the bot to Railway against the live quote API, then the wallet-signature proof once `/minipay-check` shows which signing methods MiniPay supports.

### 2026-10-11: MiniPay pivot, bot live, oracle grown, Textile answered
**Shipped:**
- **Bot live on Railway** (@arbolitoo_bot, private beta allowlist, no private keys on the host).
- **wBRL/USDT oracle** `cardinalityNext` 1 → 64 on mainnet (tx `0x4706ee55…4dab`, 0.29 CELO, tagged).
- **Textile:** firm quotes are taker-exclusive. Proven with a real firm quote (cancelled) replayed on a fork; see 04-reference.
- **Decision: MiniPay primary, MiniPay-native wallets** (see Decisions).
- **ArbolitoGuard v2** (`contracts/src/ArbolitoGuard.sol`):
  - The user's MiniPay EOA is the account. It sets a revocable operator (`setOperator`/`revokeOperator`) and configures caps, contacts, slippage and price refs with its own transactions (`configure`, `msg.sender == account`).
  - The operator can only `swapFor` (recipient hard-coded to the account, pinned pools, caps, TWAP/price-ref floor) and `sendFor` (saved contacts), or pause.
  - No Textile operator path, because fills are taker-exclusive. The `reactor` constructor arg was dropped.
  - **Tests:** 43 unit tests (incl. a fuzz showing the operator can only pay the account or contacts), 7 fork tests, and a TS fork test of a MiniPay-style EOA + operator (7/7).
  - **Gas:** `swapFor` 1-hop ≈ 244k, `sendFor` ≈ 80–97k, `configure` ≈ 110k, `setOperator` ≈ 47k, deploy ≈ 3.04M.
- **Fixed two stale tests:** the v1 wBRL fork test now forces the oracle outage; the executor test's fake hung tx now throws viem's timeout error.
- **Totals:** 105 forge + 21 forge fork; 186 vitest unit.

**Next:** the MiniPay mini app in `apps/web` (auto-connect, quote → MiniPay confirmation → receipt), Telegram's "Confirm in MiniPay" deep link + wallet linking, and the in-MiniPay checks listed under Decisions. The guard v2 mainnet deploy needs the founder's go-ahead.

### 2026-10-10: Session guard contract + bot core
**Shipped (merged to main):**
- **ArbolitoSessionExecutor** (`contracts/src/ArbolitoSessionExecutor.sol`): an ownerless, immutable guard that is the session key's **only** approved target.
  - Swaps go only through 3 pinned pools, with the recipient hard-coded to the account. The approval is exact and reset afterwards.
  - Sends go only to admin-approved contacts.
  - The Textile passthrough measures balance deltas, refunds unspent input, forwards output to the account, and never trusts order contents.
  - Per-token per-tx and per-day caps, contacts, slippage and unpause change **only with an EIP-712 signature from an account admin** (`isAdmin`), with nonce and deadline. The session key can't raise its own limits.
  - **Price floor:** `minOut >= max(10-min TWAP, admin-signed PriceRef) * (1 - slippage)`. A never-configured account is fully blocked.
  - **Tests:** 47 unit + 12 fork Foundry tests (real Celo pools and the real Textile reactor); TS fork test with the guard as the only session-key target (v0.6/v0.7).
- **Math verified against upstream:** our TickMath/FullMath ports match Uniswap v4-core (MIT, commit 46c6834) **exactly**. All 21 TickMath constants are identical, and 5 differential fuzz properties pass at 20,000 runs each (`contracts/test/UniswapV3MathDifferential.t.sol`; the upstream copies are test-only in `contracts/test/reference/uniswap-v4/`).
- **Telegram bot core** (`apps/agent`): /start, /quote, text and voice via the DeepSeek tool loop, cards with atomic pending actions, Ripio deep links. Confirm does not execute yet.
- **Test totals:** 62 forge + 14 forge fork; 179 vitest unit.

**Blocked / waiting:**
- **TS fork suite:** anvil timed out on forno (5.7 s per request, network degraded on this machine); it passed 16/16 in the agent's run. Re-run when the network recovers.
- **Postgres:** Neon port 5432 times out from this machine (HTTPS fine); the db tests are pending.
- **Founder decisions:**
  1. Deploy the bot to Railway with a beta allowlist.
  2. Mainnet tx `increaseObservationCardinalityNext` on the wBRL/USDT pool (cardinality 1 makes the TWAP unusable for 10 min after any wBRL trade; ~20–25k gas per slot).
  3. Ask Textile whether a firm quote bound to the account settles when the guard is `msg.sender`.
  4. Guard mainnet deploy (~3.8M gas), when ready.

**Next:** Mini App onboarding (thirdweb login → account → one-op setup: deploy + approve the guard + grant the key + signed config); wire Confirm → session-key UserOp via the guard → relayer `handleOps` → receipt.

### 2026-10-09: Phase 2 block 1 (parallel build)
**Shipped (merged to main):**
- **packages/db:** Drizzle on Neon. Tables users, contacts, receipts, spend_ledger, pending_actions, messages; migration applied. `DbLedger` keeps caps per signing wallet across restarts (4 integration tests against Neon).
- **packages/llm** (agent branch, 57 tests):
  - DeepSeek chat client with bounded retries and typed errors
  - strict zod tool schemas (no tool moves funds; the user must tap Confirm)
  - a tool-use loop with injected handlers
  - es-AR/pt-BR/en prompts and language detection
  - Groq Whisper speech-to-text
- **Textile firm execution** (agent branch, 18 unit + fork tests): `executeRoute` runs mixed Uniswap/Textile routes leg by leg.
  - Each firm quote is taken for the actual amount the previous leg delivered (from its Transfer logs).
  - Before broadcasting, it checks spender, reactor, minOut and expiry; any failure cancels the RFQ. Approvals are exact.
  - It reports to `/submit`, and a later-leg failure returns a `partial` result naming exactly what the user holds.
  - `sendGuarded` raises `BroadcastError` carrying the tx hash. Still gated by `TEXTILE_RFQ_ENABLED`.
- **apps/agent (started):** es/pt/en strings, route card with Confirmar/Ver alternativas/Cancelar buttons, route serde.
- **Tests:** `pnpm test` is 10 forge + 144 vitest (unit, db and fork projects), all green.

**Wallet spike (founder chose smart accounts):**
- thirdweb factories (v0.6 `0x85e2…DF00`, v0.7 `0x4bE0…dceb`) and both EntryPoints are live on Celo.
- Session-key permissions are target-level only (approvedTargets, native limit, time window). **There are no ERC-20 amount limits, so caps stay server-side.**
- On a fork, `execute` from a non-admin reverts "Account: not admin or EntryPoint.", so a session key must act through UserOps.
- **Running now:** a fork spike to prove Arbolito can self-bundle zero-fee UserOps (no hosted bundler or paymaster) and to settle attribution placement.

**Track 2 (Textile):** organizer suggestions recorded in docs/08. The "treasury bot that quotes to manage its own currency exposure" fits Arbolito Desk.

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
### 2026-10-09: apps/web v0 (receipt pages, metrics, landing)
**Shipped:**
- **`/r/[id]`:** public receipt page.
  - **Amounts:** shown in the users' currencies (`R$ 10 → ARS 3.177,41`), with the effective rate and the savings line.
  - **Comparison table:** official, MEP, CCL, crypto and blue rates, plus the market mid. USD/ARS references are crossed through the USD/BRL mid.
  - **Route:** the chosen route with per-hop venues, the alternatives considered, and celoscan links for the execution and anchor txs.
  - **Verification panel:**
    - The browser canonicalizes the JSON, recomputes keccak256, and looks the hash up over forno: `anchoredAt`, then the `ReceiptAnchored` log, then routeId and `isEmitter`.
    - The JSON is editable, so a one-character change visibly stops matching.
    - `verifyBundle` also runs server-side, cached for 1 h.
  - **Raw JSON:** served at `/r/[id]/bundle.json`.
  - **Superseded receipts:** `*.superseded.json` is served at `/r/<id>.superseded`. Rows with `superseded_by` get a "superseded by …" notice, and the corrected receipt links back.
- **`/metrics` v0:**
  - **Numbers:** unique wallets, onchain conversions (+ anchors), receipts, routed USD volume, median savings vs official (ARS corridor), wFIAT volume by token, and corridors. Each one links to its receipts or to celoscan.
  - **Superseded receipts:** listed but not counted.
  - **Refresh:** data is cached for 60 s and the page refreshes itself every 60 s.
  - **Placeholders:** Desk, USA₮, buy and API sales show "coming soon".
- **`/`:** a landing page with links to @arbolitoo_bot, the metrics and the latest receipt.
- **Languages:** copy in es/pt/en via `?lang=`; Spanish is the default.
- **Data:**
  - The `receipts` table is read first; `packages/db` gained read queries.
  - It falls back to `docs/receipts/*.json` when `DATABASE_URL` is unset or the DB doesn't have the receipt.
  - The JSON files ship with the functions via `outputFileTracingIncludes`, and the DB pool is attached with `attachDatabasePool`.
- **Tests:** 35 new unit tests in `apps/web/test`.
  - **Coverage:** formatting; the browser canonical/hash vs `packages/proof`, pinned to the 3 anchored hashes; the ABI slice; the file fallback; the receipt view; and metrics.
  - **Setup:** the vitest `unit` project now includes `apps/*/test`.
  - **Typecheck:** `apps/web` has its own tsconfig (`pnpm --filter @arbolito/web typecheck`) and is excluded from the root one.

**Gap:** nothing writes to the `receipts` table yet. Until the bot or smoke path inserts rows, the site serves the committed JSON files.

**Next:**
- Insert receipts into the DB when they are anchored.
- Connect Vercel (root dir `apps/web`).
- Set `PUBLIC_BASE_URL` once the domain is known.

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
