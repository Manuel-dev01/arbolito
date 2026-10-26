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
### 2026-10-26: full QA pass (audit + browser sweep), one fix batch
- **How:** six read-only auditors (correctness, UX/state, API contract, resilience, misleading content, mobile) found 67 issues; each was checked by two independent skeptics trying to refute it against the code and the intended behaviour (45 confirmed by both, 17 contested, 5 refuted). A Playwright sweep loaded every page at 1440 and 390, clicked every button (the Mini App two levels deep in demo mode), and checked console errors, failed requests, overflow and stuck spinners.
- **Worst finds, fixed:**
  - "Pause Arbolito" called a route that only existed in demo mode: the real switch failed and rules kept running. Pause is now one signature and no fee (`POST /autonomy/pause`, table `autonomy_pauses`, migration 0008 applied); the rules runner skips paused accounts; replayed or stale signatures are refused.
  - A valid receipt showed "Doesn't match" on /r: forno answers null for about one receipt lookup in three on week-old txs, verification read that as "not found", and /r cached it for an hour. Now verification asks again (15/15 live checks verified), other RPC errors show "unavailable", and only passing checks are cached.
  - MiniPay's back button after "Sent" reopened a live "Confirm" for the same transfer (double send). Back after a finished change or send now goes home.
  - A cross-currency send whose swap landed but whose transfer was declined said "No money moved". It now says the money was changed and is in the account, not sent.
  - Rule runs that hit an RPC/DB error after being claimed stayed "running" and the month was silently skipped; now they close as skipped and the user is told. The DB pool no longer crashes the bot on a dropped idle connection. Telegram card watchers retry instead of stopping. The Western Union runner waits a full refresh after a paid read that stored nothing.
  - "Change limits" / "Contacts it can pay" started from blank defaults and could leave deselected contacts payable onchain; they now start from the guard and remove deselected contacts.
  - Copy that promised things that don't exist: notify-me on no market, Telegram messages for Mini App conversions and Ripio deposits, phone-number lookup, rate alerts, "1 confirmation", the landing's x402 API tile, the bot's "I'll send you another quote".
- **Also:** favicon and app icons; `GET /quote/:id`; Telegram links never prepare a quote they can't show; chat failures show as failed; receipts retry; the public receipt for a send names the recipient; Western Union only for dollars → pesos/reais on /r; /desk reasons translated; 404 in the browser's language; small-phone keypad, 44px targets, toast position, safe areas; demo sheet labels in the app's language.
- **Checks:** typecheck clean, 441 unit tests (new: pause, contact removal, Western Union directions), local production build swept clean, then production swept clean.
- **Deployed:** Vercel (twice: the re-sweep caught forno's flaky receipts, fixed with retries; all three real receipts show Verified). Railway after the founder re-ran `railway login`: the bot restarted with both runners on (one 409 during the rollover, then stable).
- **Blocked (desk):** the restart showed Stitch refusing to start: the desk wallet's wBRL allowance to Permit2 is down to 0.01 wBRL (the bounded 100 wBRL from 2026-10-15 was spent by fills). New `pnpm desk:approve <SYM> <amount> [--fork|--live]` tops up one bounded approval; 300 wBRL rehearsed on an anvil fork. Waiting for the founder's go-ahead to send it (gas only). Other allowances have room (USDT 120, wARS 32,000, wCOP 63,400, USDC 20, USA₮ 20).
- **Not fixed (by decision):** the Discover steps on the no-MiniPay gate (wait for the listing); Textile proof on sends (production has the partner key); the landing hero's design countdown.

### 2026-10-21: Railway back; Western Union readings flowing
- Railway resumed builds, but the queued pushes never deployed (GitHub auto-deploy didn't pick them up), so the bot was deployed from a snapshot of main.
- buy changed its browser `wait` command overnight: `{action:"wait", target:"3000"}` now fails ("wait target must be a CSS selector … use milliseconds for a timed wait"), so the first runner session read nothing (tx `0xc8e8d48c…`). The reader now pauses on our side and snapshots up to three times.
- **First stored readings** (tx `0x0f972328…a3cc`, US$ 0.004212): Western Union USD→BRL **4.8312**, USD→ARS **1,623.00**. Live quote check: US$ 10 → wBRL shows **+4.35% vs Western Union** (≈ R$ 2.10 more); US$ 10 → wARS **−0.01%** (same rate, before Western Union's fee). /metrics lists both readings with the payment; amounts now shown to 4 decimals.
- buy spend so far: 8 sessions, ≈ US$ 0.033, all from the buy payer `0xD07b…3e58`.

### 2026-10-20 (evening): T3 "vs Western Union" through buy
- **Track choice (founder, "don't overbloat"):** T3 Build with buy, as one feature that strengthens T1: quotes and receipts compare with Western Union. T2b (USA₮ x402) dropped: it needs an outside counterparty paying us repeatedly.
- **x402 v1 client** (`packages/x402`): free 402 = quote; non-402 = error; price checked against our own maximum and the caps before signing; refused → reservation released; error/no answer after paying → kept, never retried. Domains verified against USDT/USDC onchain.
- **buy payer** `0xD07b…3e58`, 1 USDT from ops. Six paid browser sessions so far ($0.0247 total), each settled on Celo; they established how the session API works (commands, `target`, `gettext` blocked → `snapshot`), that Western Union's converter is readable (US$ → R$ 4.82 vs Arbolito ~5.06: about 5% more reais; US$ → ARS 1,618.75, about the same as ours before Western Union's fee), and that Remitly isn't usable (crashed the session; no peso payout). One local session was lost to this machine's network (tx `0x70ea9275…`); browser commands now resend on network errors (safe: the session is already paid).
- **Built:** `packages/competitors` (snapshot reader, session driver, tested on captured pages); `competitor_rates` (migration 0007, applied); the bot refreshes every 6 h (`COMPETITORS_RUNNER=live`, ~US$ 0.017/day, plausibility check against market references, stops on an unclear payment); Western Union becomes a reference (`western_union`) whose source names the buy payment, so quotes, ProofBundles and the public receipt cite it; "vs Western Union" on the quote card, chat card and receipt; /metrics lists each reading with its payment. Vercel deployed.
- **Blocked:** Railway paused new builds for all workspaces (their status page: "New builds are temporarily paused", major outage), so the bot hasn't picked up the runner or its env vars yet (set: `BUY_PAYER_PRIVATE_KEY`, `BUY_PAY_TOKEN=USDT`, `COMPETITORS_RUNNER=live`). Queued builds start when Railway resumes; running services are unaffected.
- **Next:** confirm the first stored readings after Railway resumes; then the demo and submission package; pilot users.

### 2026-10-20 (afternoon): Home screen polish; desk stats, capital fix, buy sizing; strategy write-up
- **Mini App home** (founder: "looks off, something's missing"): greeting by time of day with the wallet under it, the "Arbolito is acting for you · N rules" chip, logo-colour accents and a pesos/reais/dollars split bar on the balance card, line icons on tinted action tiles (Change filled), a mic on the ask bar, "The dollar today" card (official peso and the gap), cents on small conversions, icons on activity rows. Checked in headless Chrome before deploying.
- **/desk P&L was against the wrong capital:** 40 USDT instead of the 120 USDT funded (three 40 USDT deposits from `0x7769…a734`, blocks 80170952, 80313359, 80404036, read onchain). Corrected; the result was overstated by ~US$ 80.
- **Desk stats:** snapshots now record whether each corridor was quoting; /desk shows uptime per corridor (24 h, 7 days). Stitch logs only the RFQs our quote won (no requests or losses, even at debug), so those go to `desk_rfqs` and /desk shows the count; we don't publish a win rate we can't measure. Migration 0006 (applied).
- **Buy-side overshoot fixed:** a corridor reopening at US$ 17.6 of wBRL offered its full US$ 20 and one fill (2026-10-20 13:22, −0.01% edge) took it to ~US$ 37; the rebalancer would then sell the excess back a few bps under fair. The buy side now offers only the room left under the cap, in US$ 5 steps with a dollar of tolerance and hysteresis. Live: wBRL buy off (at cap), the others offering US$ 5–20. The rebalancer is holding the excess wBRL because Uniswap pays 25 bps under fair (45 bps worst case) against a 40 bps limit.
- **docs/DESK-STRATEGY.md:** the strategy for the Textile judges (architecture, fair value, devaluation-aware pesos, skew bounds, breaker, caps and rebalancer, the pause-only risk officer and what running it taught us, honest results, how to verify, code map).
- **Desk now:** 6 fills, ~US$ 90 executed, edges −0.01% to +0.06%; NAV ≈ US$ 120 against 120 USDT.
- **Telegram linking now needs the wallet's signature** (personal_sign over "Arbolito: connect Telegram / Account / Code", checked before the code is looked up). Shared `signedBy` helper for rules and linking.
- **README rewritten for judges:** what's live, onchain addresses with links, how it's built, the repo map, how to run it. The planning-pack README (T3 claims, "deadline TBD") is gone.
- **Next:** decide T2b (x402 FX API in USA₮) and T3 (buy) with the founder; the rest of the submission package (demo video, Loops entry).

### 2026-10-20: Standing rules live (payday split, monthly sends); desk RFQ logging
- **Standing rules** (`packages/rules`, founder-approved): the T1 "agent acts on its own" piece.
  - **Kinds:** monthly send to a saved contact (optionally converted: USDT → pesos/reais, the contact gets exactly what the swap returned) and payday split (a share of each incoming USDT payment sent by someone else, into pesos/reais/USA₮/USDC).
  - **Creation:** in the Mini App chat (`prepare_scheduled_send`, `prepare_payday_split`, `list_rules`). A rule turns on only when the account signs its exact text in MiniPay (personal_sign; names the account, the contact's full address and the rule id). Drafts need autonomy on and, for sends, a guard-allowed contact. Listed with Cancel (signed) in Limits & security.
  - **Runner:** in the bot service (`RULES_RUNNER=live`), every 60 s, with the operator key `0xeA71…36b4` through ArbolitoGuard v2. A run is claimed in `rule_runs` before any tx ((rule, trigger) unique: a month or a payment runs at most once). Preflight reads the guard and wallet; sendGuarded (tagged, capped at our US$ 5/25 build caps on top of the user's, 1.25x base-fee cap); nothing retried; an unconfirmed tx stops the rule. Linked users get a Telegram message per run.
  - **Tests:** pure rules (5), DB claims (2), backend + chat (4), and a fork test against the deployed guard (monthly send converted to wARS once; split of an outside payment only, ignoring the account's own transfers and small ones; cap skip; revoked permission stops the rule).
  - **Allowance fix:** turning autonomy on approved one day's cap, which one run used up. It now approves the daily cap for each day of the permission (30); the guard still enforces the per-operation and daily caps.
  - **Operator gas:** 0.2 CELO from ops ([`0x5c20d9f8…f006`](https://celoscan.io/tx/0x5c20d9f8eb276019fca7c66b14634b0e2189399a80e56bbb6d16e4925744f006), tagged; `pnpm fund:gas operator 0.2`, rehearsed on a fork).
- **Desk RFQ stats (in progress):** Stitch logs only selected quotes at INFO. `RUST_LOG=…,stitch_bot::rfq=debug` on desk-feed (also silences per-tick spam); the supervisor now hands each line to an `onLine` hook. No RFQ arrived in the first ~30 min, so the parser waits for real lines.
- **Founder feedback fixed:** Settings showed Limits "Off" and Telegram "Connect" for a wallet that had both on. Autonomy status is now re-read when Settings opens (retried; polled after the setup txs; unknown shows "…"); contacts come from `isRecipient` on the phone's contact wallets (the 30-day event replay exceeded forno's 5,000-block cap and returned nothing); new `GET /link/status` shows the linked Telegram name. Bot: a `connect_minipay` tool (asking for a code now sends one) and the "/" command menu in es/pt/en. Verified live: linked as "Emmanuel", autonomy on, Ops allowed.
- **Self agent ID:** dropped (needs a passport).
- **Next:** the founder tries a rule on the phone; RFQ parser + win-rate on `/desk`; strategy write-up; submission package.

### 2026-10-19 (evening): First real Mini App test on the founder's phone; receipts now anchor live
- **Founder's test (MiniPay, wallet `0x7769…a734`), all checked onchain:** 2 USDT → 3,232.46 wARS (Textile fill), 3,232.45 wARS → 2.009 USDT (Uniswap), 1 USDT sent to ops (same-currency send), 1 USDT → 5.0599 wBRL (Textile, from the chat card). A 5 USDT attempt showed "we don't know": no tx left the wallet (MiniPay errored before returning a hash, most likely the sheet was closed).
- **Fixes shipped (`69dfcd3`):**
  - A send error with no hash is checked against the account's mined nonce for ~12 s; if it never moves the app says no money moved ("not-sent") instead of "unknown".
  - Telegram linking: Telegram's link opens our page in its own browser (no wallet; MiniPay has no deeplink to an unlisted app), so linking dead-ended. Now the user types the bot's code in Settings → Telegram; the bot's message says so, and the page outside MiniPay shows the code and steps.
  - "You saved" only when the user got more than official (pesos → dollars costs more than official); dollar savings in cents; the official meter clamped.
  - Removed the false "Also sent to your Telegram"; the Mini App chat replies in the language the user writes in.
- **Receipt anchoring live** (founder go-ahead): `pnpm anchor:wallet` created the anchor wallet `0x89dC…7CA4`, ops funded it with 0.3 CELO and made it an emitter (2 tagged txs), it anchored the 3 registering receipts (all now "verified"), and `ANCHOR_PRIVATE_KEY` + `ANCHOR_ENABLED=true` are on Vercel production, so new receipts anchor at submit. Rehearsed on an anvil fork first. ~0.01 CELO per anchor at 202 gwei; top up the wallet when it runs low.
- **ArbolitoGuard v2 deployed** (founder-approved): `0x411E44dB70476F74C3560F5cCFdbc8c63f231d33`, tx `0x8b4aa0da…61c1`, 3.095M gas ≈ 0.627 CELO from ops, tagged. `pnpm deploy:guard` (plan → fork rehearsal → --live) also created the operator key `0xeA71…36b4` (.env only). The USDC/USDT 0.01% pool is now pinned too (it's immutable, so it went in before deploy; 1,500 TWAP observations). First live attempt was refused by the node before broadcast (viem's ~2x fee cap exceeded the ops float); `sendGuarded` now takes explicit `fees`, and the deploy uses a 1.25x base-fee cap. `GUARD_ADDRESS` and `ARBOLITO_OPERATOR_ADDRESS` are on Vercel production, so "Turn on" in the Mini App now prepares real txs.
- **Ops wallet after today:** ~0.64 CELO, 5.4 USDT. The operator needs a little CELO before standing rules execute.
- **ERC-8004 registered** (approved): agentId **9976**, owner ops, tx `0xbb465125…ce89`, tagged. The agent URI is served by the web app at `/.well-known/agent-registration.json` and lists only live services (x402 FX API and MCP removed until they exist; `x402Support: false`). A 512×512 icon (`/arbolito.png`) doubles as the MiniPay Discover icon. `ERC8004_AGENT_ID=9976` on Vercel.
- **Self agent ID:** session started (linked mode, human = founder's MiniPay wallet, agent `0x91B9…7c14`); waiting for the founder's passport scan in the Self app.
- **Desk rebalancer live** (approved): sells soft inventory above a corridor's cap back to USDT, ≤ US$ 5 a slice every 10 min, only within 40 bps of fair (10 for stables), Uniswap or (after the buy side has been off 5 min) Textile, never retried. Dry on Railway first, then live. First two sales: 25.31 wBRL → 4.9994 USDT ([`0xfd5f56f1…481e`](https://celoscan.io/tx/0xfd5f56f13697844b5cb78c605e1d0575ec41de406927435314f1c42ff1de481e)) and 25.28 wBRL → 4.9969 USDT ([`0x3151eef0…5ead`](https://celoscan.io/tx/0x3151eef061ca86eb37153ecfdc1ee0e9c6d5dd0066ea4c29f52e3e3ec3055ead)). **Gas paid in USDT** (CIP-64 type 0x7b, adapter `0x0E2A…6f72`), the first fee-abstracted sends from our own signer; both tagged.
- **Risk-officer lockout fixed:** a paused corridor holds every tick, those holds were counted as breaker holds, and the officer read them as an unstable market and paused again. wBRL had not been quoted for ~10 h, wCOP ~9 h, wMXN ~4 h. Now only the breaker's own holds count (regression test). Lost quoting time is the main cost; watch `/state` for repeat pauses.
- **Risk officer over-pausing fixed:** after the lockout fix it paused wARS and wMXN for an hour over 40-52 bps of source dispersion (normal; the breaker tolerates 120-150). The signals now include each corridor's `breakerMaxDevBps` and the prompt says pausing costs scored volume. First review after the change: all six corridors normal, with correct reasons. Third rebalance sale: 25.30 wBRL → 4.9999 USDT (`0xdbccf73d…8d75`).
- **Self agent ID: dropped** (2026-10-20). Self asks for a passport, which the founder doesn't have. Two sessions expired unscanned. ERC-8004 (agentId 9976) covers agent identity.
- A full unit run once failed one test under machine load and passed 407/407 on rerun (flaky timing, not a regression).
- **Next:** standing rules (payday split, scheduled sends) executed by the operator; desk quote and win-rate stats on `/desk`.

### 2026-10-19 (later): Both desk issues fixed
- **Textile `/submit` was not failing.** Textile recorded our tx hashes (`submittedAt`) and marked both RFQs `filled`. Our status schema rejected the `failReason: null` it returns, so a success read as a failure. The schemas now accept nulls, with a test using the live response. This also fixes the Mini App's submit, which uses the same call.
- **Hard inventory caps:**
  - Each corridor has a `maxSoftUsd` (wARS, USDC, USA₮ and wCOP 15; wBRL and wMXN 25). At the cap, the buy side is dropped from Stitch's config and the sell side keeps quoting. It resumes below 80% of the cap.
  - **Why:** Stitch re-offers a side's full size after every fill, so the desk had bought US$ 40 of wBRL.
  - **Architecture change:** Stitch now runs as a supervised child of `desk-feed` (official v0.1.312 Linux build, pinned by sha256 in the Dockerfile). The supervisor restarts it only when the generated config changes, at most once a minute, and never runs two instances. Stitch reads the feed on localhost, and the `[rfq]` block comes from `DESK_MAKER`.
  - **Cutover:** deployed feed-only, then `railway down` on `desk-stitch`, then `DESK_PRIVATE_KEY` and `DESK_RFQ_API_KEY` were piped into `desk-feed`.
  - **Live:** the wBRL buy side went off immediately (≈ US$ 40 held) and the RFQ session was accepted.
  - The `desk-stitch` service was deleted with the founder's OK, removing its copies of the key and credential. The arbolito project now runs only `desk-feed` and `arbolito-bot`.

### 2026-10-19: Six corridors live; MiniPay check passed; first Textile taker buys
- **MiniPay check** (founder's phone): all passed. Detection, personal_sign and signTypedData_v4 work, and the tag survives exactly. MiniPay picks USDT as the fee currency on its own. Details in 04-reference.
- **wCOP/USDT and wMXN/USDT live** (third 40 USDT from the founder):
  - **wCOP:** bought via Textile with the partner key, the first live Textile taker execution: 2 × 5 USDT → 31,865.88 wCOP. Both sides at US$ 10.
  - **wMXN:** bid-only (US$ 20), since nobody on Textile sells wMXN for USDT yet.
  - Stitch quotes six pools.
- **Known issues:**
  - **Textile `/submit` failed** after both wCOP swaps. They settled onchain and Textile's indexer reconciles fills, but the error text wasn't captured; the funding script now prints executor warnings. The Mini App's submit uses the same call, so investigate.
  - **No inventory cap per corridor:** the desk bought another US$ 20 of wBRL on 10-18 (it holds 203 wBRL ≈ US$ 40, against a US$ 10 sell cap). The skew now leans it to sell. Add a hard cap that turns a buy side off when the soft asset passes a limit.
- **Desk:** 4 fills, all wBRL, all from taker `0x5dc2…b77f`, all at positive edge. NAV ≈ US$ 120.1 vs US$ 120 funded (before the wCOP purchases).

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

**Contract gaps flagged by the UI** (`TODO(contract)`): send-to-contact prepare, `GET /quote/:id`, instant autonomy pause, receipts list, phone → address lookup, no-market notify, in-app withdraw, link status. *(2026-10-26: all closed except phone lookup, no-market notify and in-app withdraw, whose promises were removed from the copy.)*

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
