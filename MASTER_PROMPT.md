# Arbolito: master build prompt

**How to use:**
1. Open Claude Code in `Desktop/hackathons/arbolito`.
2. Paste everything below the line as your first message.
3. For later sessions, use the **resume prompt** at the bottom.

---

You are the lead engineer building **Arbolito** for Celo's **Agents on Open Rails** hackathon. I'm the founder; I hold the keys, the funds and the final say. Your job is to ship a winning, working product on Celo mainnet, at full ambition, in the order the plan sets.

## 1. Context: read these first, in this order
1. `CLAUDE.md`: standing rules (money safety, secrets, conventions, git). They override anything below if they conflict.
2. `PLAN.md`: strategy, scope cut lines (P0/P1/P2), the day-by-day roadmap, fallbacks.
3. `docs/STATUS.md`: what's done, what's blocked, the spike table. Continue from here.
4. `docs/02-product-spec.md`: personas, features with acceptance criteria, autonomy policy, conversation design.
5. `docs/03-architecture.md`: monorepo layout, core types, flows, data model, security model, spikes.
6. `docs/04-reference.md`: verified addresses, pools and endpoints (canonical).
7. Skim when relevant: `docs/01-research.md` (why), `docs/05-demo-submission-adoption.md` (what judges see).

**In one paragraph.** Arbolito is an autonomous "cambista" agent. In Telegram (es/pt/en, voice notes) it holds, converts and sends wARS, wBRL and USA₮. It routes through the best mix of Textile v2 RFQ firm quotes and Uniswap v3 on Celo, and anchors a verifiable ProofBundle receipt onchain for every route. It runs **Arbolito Desk**, a Textile filler via Stitch driven by our AI fair-value feed. It keeps its dollars in USA₮. It pays buy (Celo's x402 marketplace) in USA₮ for browser sessions, social data and its own VM. It sells an x402 FX API plus an MCP server so other agents can hire it.

Tracks:
- T1 Ripio wFIAT: functionality, utility, UX, onchain adoption
- T2a Textile: quoted volume, profit, innovation
- T2b USA₮: real USA₮ x402 settlements
- T3 buy: problem, integration depth, demand for buy

## 2. Locked decisions
- **Repo:** pnpm workspace monorepo, TypeScript strict, Node 22+, viem, zod env schema, Vitest. Foundry for contracts.
- **Apps:**
  - `apps/agent`: grammY Telegram bot + Claude tool loop + STT + rule scheduler
  - `apps/fx-api`: Hono + `@x402/hono` v2 seller
  - `apps/mcp`
  - `apps/desk`: `/fairvalue` + risk officer + hedger + provisioner + Stitch config
  - `apps/web`: Next.js Mini App, `/r/:id`, `/metrics`, `/desk`
- **Packages:** `config`, `chain`, `router`, `proof`, `buy-client`, `x402`, `db` (Drizzle + Postgres), `llm`.
- **LLM:** Anthropic API, `claude-sonnet-5` for the chat agent and `claude-opus-5-5` for the desk risk officer. **Load the `claude-api` skill before writing any Claude SDK code.**
- **Wallets:** smart accounts plus scoped session keys (thirdweb on Celo) is the default. The fallback path is defined in `docs/03-architecture.md` (EIP-7702 EOAs, or EOAs with server-side limits), pending the Day 2–3 spike.
- **Deploy:** agent, fx-api and mcp on Railway, Fly or a VPS; web on Vercel; Postgres on Neon; desk on a buy VM (fallback VPS).

## 3. How you work
- **Verify before you build.** These APIs changed recently and some docs are thin. Before coding each integration, fetch the live source of truth:
  - Textile `openapi-v2.json` and the v2 RFQ docs (who submits the settlement tx? Permit2 witness? webhook shape?)
  - Celo x402 docs and `GET https://api.x402.celo.org/supported` (permit2-asset config)
  - `@celo/buy` README and catalog (`https://gateway.usebuy.ai/v1/catalog`), browser-session control, compute skill
  - Uniswap's Celo deployment addresses (QuoterV2, SwapRouter02)
  - thirdweb session-key support on Celo

  Record findings in `docs/04-reference.md` and `docs/STATUS.md` (spike table).
- **Verify addresses onchain.** Build `pnpm verify:addresses`: for every token, read symbol and decimals; for every pool, read token0, token1 and fee; for every contract, check that code exists. It must pass before anything touches mainnet.
- **Spikes before features.** Resolve the spike table in `docs/03-architecture.md` with the smallest possible experiment. Apply its decision rules; don't stall.
- **Fork first.** Every money path gets a test on an anvil fork of Celo mainnet before any live send. Firm Textile quotes and Uniswap swaps can execute against the fork.
- **Mainnet only with my explicit go-ahead in this session.** Respect the caps in `CLAUDE.md` (≤ $5 per action, ≤ $25/day while building). Live sends go behind a `--live` flag.
- **Never blindly retry a paid call.** Quote, then pay, then reconcile.
- **Keep moving.** If you're blocked on a key, funds or a decision, ask me one crisp question, then keep working on unblocked items.
- **Evidence over claims.** When you say something works, show the test output, the tx hash, or the receipt URL.
- **End every work block with a report:** shipped (with evidence) / blocked / next. Append the same to `docs/STATUS.md`.
- **Commit** small and often. No AI attribution trailers. Never commit secrets.

## 4. Always ask me before
- any mainnet transaction or paid HTTP call (including buy and x402)
- deploying or upgrading a contract on mainnet
- registering ERC-8004 or Self identities (I'll do the Self QR scan)
- messaging or posting anything to external people or channels
- changing caps, desk inventory limits or the session-key scope
- adding a paid third-party service

## 5. This session's objective: Phase 1 (roadmap Days 1–2)
Work in this order. Check off items in `docs/STATUS.md` as you go.

1. **Hackathon facts.** Ask me for the deadline, hub link, multi-track rule and attribution code (or whether they're still TBD). Record them in `docs/STATUS.md`.
2. **Scaffold** the monorepo exactly as laid out in `docs/03-architecture.md`.
   - `.env` loading via a zod schema built from `.env.example`. `.gitignore` covers `.env`, keys and wallets.
   - `git init` with the first commit.
3. **`packages/config` + `pnpm verify:addresses`**, with config populated from `docs/04-reference.md`. Run it; fix or flag any mismatch.
4. **`packages/chain`:**
   - public and wallet clients (forno, plus a Chainstack slot)
   - attribution suffix appended to every tx
   - fee-currency helper (adapter addresses)
   - a sender that enforces the per-action and daily caps before signing
5. **`packages/router`:**
   - Uniswap v3 adapter (QuoterV2 for the three pools in the reference; exact-input; minOut)
   - Textile adapter: public tickers now; v2 RFQ preview and firm quote per the OpenAPI spec once the key exists, behind a feature flag until then
   - planner for direct and two-hop routes (wBRL→USDT→wARS, USA₮→USDT→wARS) that picks the best `expectedOut` and keeps the alternatives
   - CLI: `pnpm quote <from> <to> <amount>` prints the best route, the alternatives, and the official/MEP/CCL/crypto references
6. **`packages/proof` + `contracts/ArbolitoReceipts.sol`:**
   - ProofBundle zod schema, canonical JSON, keccak256, and a verifier that recomputes the hash and finds the event
   - Foundry tests
7. **Fork e2e.** On an anvil fork, execute the best wBRL→wARS route (Uniswap legs, plus a Textile leg if the key exists), emit the receipt, and verify the hash end to end. This is a test in the repo.
8. **Mainnet smoke (ask me first).** Deploy `ArbolitoReceipts`. Run one ≤ $2 BRL→ARS conversion via the best route with the receipt anchored. Report the tx hashes and the receipt JSON.
9. **Identity prep.** ERC-8004 registration JSON (agent card listing planned endpoints, `x402Support: true`) plus a `register` script. Write out the Self Agent ID steps for me. Don't execute either until I say so.

**Phase 1 exit criteria**
- [ ] `pnpm verify:addresses` is green.
- [ ] `pnpm quote wBRL wARS 200` returns a best route with alternatives and references in under 4s.
- [ ] The fork e2e test passes in CI-style `pnpm test`.
- [ ] One mainnet BRL→ARS conversion is done, with the onchain receipt verified by the verifier. Or it's explicitly deferred by me, with the reason logged.
- [ ] Spikes "Textile v2 taker flow" and "smart-account taker compatibility" each have a written finding and a decision.
- [ ] `docs/STATUS.md` is updated with evidence.

When Phase 1 is done, stop and give me the report plus a proposed Phase 2 plan (roadmap Day 3: wallets, Telegram agent, Desk v0), with acceptance criteria taken from `docs/02-product-spec.md`. Then wait for my go.

---

## Resume prompt (for every later session)
> Read `CLAUDE.md`, `docs/STATUS.md` and `PLAN.md`. Tell me in five lines or fewer: where we are, what's blocked, and the next roadmap item with its acceptance criteria (from `docs/02-product-spec.md`). Then build it, following the working method in `MASTER_PROMPT.md` §3–4. End the block with a report and a `docs/STATUS.md` update.

## Phase kick-off prompts (paste at the start of each phase)
- **Phase 2 (Day 3–4):** "Start Phase 2:
  - smart accounts + session keys per the spike decision
  - Telegram agent (grammY + Claude tools: balance, quote, convert, send, receipt, help; es/pt/en; voice notes)
  - Mini App onboarding and approvals
  - `/r/:id` and `/metrics` v0
  - Desk v0: Stitch with a simple `/fairvalue` feed, live on Textile as soon as filler credentials exist

  Target: a stranger can onboard and convert from Telegram."
- **Phase 3 (Day 5–6):** "Start Phase 3:
  - buy-client (x402 v1, USA₮, quote-before-pay, no blind retries, non-402 = error)
  - competitor capture via browser sessions into the ProofBundle
  - X/Reddit signals
  - standing rules + Textile limit orders
  - x402 FX API (v2; USA₮/USDC/USDT + wARS/wBRL/wCOP) + `arbolito-mcp` + bazaar metadata
  - draft the upstream buy issue/PR and the buy listing request for my review"
- **Phase 4 (Day 7):** "Start Phase 4:
  - Desk v1: fair value (Textile + Uniswap TWAP + CCL/MEP/crypto refs), inventory skew, LLM risk officer regimes, Uniswap hedger, P&L ledger, `/desk`
  - buy VM provisioner with daily blue/green renewal paid in USA₮, with VPS fallback"
- **Phase 5 (Day 8–10):** "Start Phase 5:
  - hardening (`no_quote`, expiry, slippage, partial-route failure, alerts)
  - security pass
  - es/pt copy polish
  - README with architecture diagram and per-track rubric map
  - demo rehearsal checklist per `docs/05-demo-submission-adoption.md`
  - submission package"
