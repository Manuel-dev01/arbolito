# Arbolito — Agents on Open Rails (Celo) — Strategy & Execution Plan

Prepared 2026-10-04. Start the build with `MASTER_PROMPT.md`; deeper specs are in `docs/` (index in `README.md`). Kickoff 2026-10-06 12:00 GMT. Deadline and submission hub are not published yet. Confirm both at kickoff.

---

## 1. Verified intel (pulled live on 2026-10-04)

### Hackathon
- $5K across tracks + mentorship + 3 months Chainstack Growth plan. Co-hosted by Celo Community and Celo Core Co. Kickoff: https://luma.com/uk27jw1q
- Tracks and their rubrics:
  - **T1 Stable Agents: LatAm ($2K, Ripio):** agentic apps using wFIAT (wARS, wBRL, wMXN, wCOP, wPEN, wCLP). Judged on **functionality, utility, UX, onchain adoption**. IRL builder events in Argentina.
  - **T2a Open Corridors ($1K, Textile):** stablecoin trading and settlement agents on Textile FX. Judged on **quoted volume, profit, innovation**.
  - **T2b Open Corridors ($1K, USA₮):** settle **real USA₮ payments** over Celo's native x402.
  - **T3 Build with buy ($1K):** judged on **the problem, integration depth, demand created for buy**.
- Format of the last Celo agent hackathon: 10 days, a Karma project, an ERC-8004 agentId, Self verification, and a tweet tagging @Celo and @CeloDevs. Expect something similar.
- Past Celo winners: RemitRoute (rule-based stablecoin finance agent, also #1 on 8004scan), AjoAI (savings circles via MiniPay), Spawn (agent swarm, most transactions), Agentopolis. Judges' own words: "genuine economic agency", "stablecoin-native infrastructure", "mobile-first UX", "real utility, real payments, real distribution", "do more than chat".

### Onchain reality on Celo (RPC reads, 2026-10-04)
| Asset | Supply on Celo | ≈ USD |
|---|---|---|
| wBRL | 3.71M | ~$700K |
| wARS | 262.7M | ~$163K |
| wCOP | 34.0M | ~$8.7K |
| wCLP / wMXN / wPEN | 1.0M / 13.1K / 600 | <$1.1K each (seed amounts only) |
| USA₮ | 291.5K | ~$291K |

The only live LatAm corridors are **ARS and BRL**. MXN, COP, PEN and CLP have no liquidity yet.

| Uniswap v3 pool (Celo) | Fee | Address | Balances | ≈ TVL |
|---|---|---|---|---|
| wARS/USDT | 0.01% | 0x5d8ef8b839be522b9e3d60a51edb5837cd0b2391 | 112.9M wARS + 38.3K USDT | ~$108K |
| wBRL/USDT | 0.01% | 0x01c3cf91cdf7b34181c7ec8566c0236951fea40f | 131.6K wBRL + 2.9K USDT | ~$28K |
| USA₮/USDT | 0.01% | 0x070d575a713eaf5025462d0865fb0dac4b14bc38 | 63.8K USAT + 42.2K USDT | ~$106K |

**Textile FX** (public feed https://api.textilecredit.com/tickers):
- USDT↔wARS: bid 1612.98 / ask 1613.63 (about 4 bps), **24h volume $0**
- USDT↔wBRL: 5.2668 / 5.2711 (about 8 bps), **24h volume about $300**
- USDT↔NGN: **24h volume about $199K**

Makers are already quoting the LatAm corridors tightly, but almost no takers are trading against them. **Whoever brings real taker flow solves Textile's actual problem.**

- Fillers run **Stitch**, an open-source bot. It polls *your* HTTP price feed and signs firm, exclusive RFQ quotes. You configure spread (bps) and size.
- API keys come from contact@textilecredit.com (`tx_test_` / `tx_live_`). The **Celo testnet is not supported**, so Celo work is mainnet-only.
- Celo fee is 1 bps. Settlement contract: LimitOrderReactor 0xa9AA0a64769cBed4d3B1Ceb4Df01CdE915C235b3. Permit2: 0x000000000022D473030F116dDEE9F6B43aC78BA3. Gasless limit orders are supported.

**Celo x402 facilitator** (https://api.x402.celo.org, `/supported`):
- Supports x402 v1 and v2 with the `exact` scheme.
- USDC, USDT and **USA₮** via EIP-3009, plus **wARS, wBRL and wCOP via Permit2**.
- Has a gas-sponsoring extension.
- `/settle` needs an API key.

**buy** (https://gateway.usebuy.ai/v1/catalog): 168 paid capabilities, all settled in USDC, USDT or **USA₮**.
- Agent browser rentals: $0.0036 for 1 min up to $0.0091 for 10 min.
- Social data from X, IG, TikTok, Reddit, YouTube and LinkedIn: $0.006–$0.72 per call.
- Flight search and flight status.
- GCP VMs at usebuy.ai/google/vm:
  - e2-micro about $0.017/h; e2-small about $0.034/h.
  - 24h maximum lifetime.
  - Egress limited to ports 53, 80, 443 and 123.
  - e2-standard and larger require Self attestation.
- Payments use **x402 v1** (the Celo facilitator issues v2).
- Known bugs: buy-skill #4 (`buy curl` exits 0 on non-402 responses), #5 (the version mismatch above).
- Listings are curated through the buy-skill issue form.

**Identity and attribution**
- ERC-8004 Identity Registry 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432; Reputation Registry 0x8004BAa17C55a88189AE136b182e5fdA19dE9b63.
- Self Agent ID registry 0xaC3DF9ABf80d0F5c020C06B04Cced27763355944. Supports proof-of-human, OFAC checks and sybil limits.
- ERC-8021 attribution tags via `@celo/attribution-tags`. Codes are issued at hackathon registration.

**USA₮:** 0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771, 6 decimals. Fee-abstraction adapter 0x0357EE22278c922e1D36cFe6b899269b161880C4 (use the adapter, not the token).

**wFIAT addresses**
- wARS 0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d
- wBRL 0xd76f5faf6888e24d9f04bf92a0c8b921fe4390e0
- wCOP 0x8a1d45e102e886510e891d2ec656a708991e2d76
- wMXN 0x337e7456b420bd3481e7fa61fa9850343d610d34
- wPEN 0x4F34c8b3b5FB6D98Da888F0feA543d4d9C9F2eBE
- wCLP 0x61D450a098b6a7f69fC4b98CE68198fe59768651
- USDT 0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e
- USDC 0xcebA9300f2b948710d2653dD7B07f33A8B32118C

**Argentina context:** August 2026 CPI was +1.7% month on month. On 2026-09-28: official 1,550, MEP 1,551, CCL 1,617, crypto 1,615. The ~4% official-to-crypto gap is real money for anyone paid in USD.

---

## 2. Champion: Arbolito, the autonomous cambista on open rails

*Arbolito* is Argentine slang for the street money-changer. This agent does the same job:

1. **Changes money for people (T1).** A Telegram agent (es/pt/en, voice notes) holds, converts and sends wARS, wBRL and USA₮. It routes cross-border BRL⇄ARS through the best combination of Textile RFQ firm quotes and Uniswap v3. Every transfer produces a **verifiable route receipt**: all venue quotes, block numbers and a live competitor quote captured by a rented browser, hashed and anchored onchain.
2. **Runs its own FX desk (T2a).** *Arbolito Desk* is a Textile filler (Stitch plus our AI fair-value feed). It quotes wARS, wBRL and cNGN, hedges on Uniswap, and has a regime-aware LLM risk officer.
3. **Keeps its dollars in USA₮ (T2b).** USA₮ is the treasury and savings dollar. Every buy purchase and every x402 FX API sale settles in USA₮.
4. **Buys its own intel and office space (T3).** Using buy, it pays for:
   - agent browsers to capture competitor quotes (Western Union, Remitly, bank pages)
   - X and Reddit data for regime signals
   - **its own VM**, renewed daily from desk P&L
5. **Other agents can hire it.** An x402 FX API (quote, convert, send) is payable in USA₮, wARS, wBRL or wCOP. It ships with an MCP server, an ERC-8004 registration and a buy listing request, so other hackathon teams' agents can adopt it.

### Rubric map
| Rubric line | How Arbolito scores |
|---|---|
| T1 functionality | Live on mainnet: real conversions and cross-border sends with receipts |
| T1 utility | ~4% gap between official and crypto rates; BRL⇄ARS without SWIFT; payday auto-split |
| T1 UX | Chat-first in Spanish and Portuguese, voice notes, one-tap Mini App approvals |
| T1 onchain adoption | Human users plus agent callers of the FX API; public metrics page; attribution tags |
| T2a quoted volume / profit / innovation | Desk quotes three corridors, with a P&L ledger, an AI fair-value feed and a self-funding loop |
| T2b real USA₮ | USA₮ treasury; every buy call and API sale is a USA₮ x402 settlement |
| T3 problem / depth / demand | Browser + social + compute purchases; handles the x402 v1/v2 mismatch; upstream fixes; listing a new service |

### Scope and cut lines
- **P0 (must be live by Day 5):** Telegram agent, wallets with scoped session keys, a best-execution router (Textile RFQ + Uniswap) for wBRL⇄USDT/USA₮⇄wARS, receipt contract and pages, public metrics page, ERC-8004 + Self + attribution, Desk v0 (Stitch with a simple feed).
- **P1 (Days 5–8):** buy browser competitor quotes, social regime signals, standing rules (payday split, scheduled sends, Textile gasless limit orders), the x402 FX API + MCP + buy listing, Desk v1 (AI feed, skew, hedging, self-hosted on a buy VM).
- **P2 (only if P0 and P1 are green by Day 7):** group "vaquinha" settle-up mode, a WhatsApp channel, a wCOP corridor via x402.

### Architecture (monorepo: pnpm, TypeScript, viem)
- `packages/router`: venue adapters and the route planner.
  - Textile v2 RFQ (preview, firm, execute)
  - Uniswap v3 QuoterV2 and SwapRouter on the three pools above
  - multi-hop planner (BRL→USDT→ARS, USA₮↔USDT) with split routing and slippage guards
- `packages/proof`: the ProofBundle.
  - Contents: quotes, maker signatures, block number, reference rates (official, MEP, CCL, crypto), competitor capture hash.
  - Stored as canonical JSON, then keccak256.
  - `ArbolitoReceipts.emitReceipt(hash, route)`; the attribution suffix goes on every tx.
- `apps/agent`: Telegram bot (grammY) plus a Claude tool-use loop.
  - Tools: balances, quote, convert, send, create_rule, place_limit_order, explain_receipt, buy_* wrappers.
  - STT for voice notes.
- `apps/web`: Next.js Mini App with approvals, onboarding (Ripio deposit/withdraw guides), receipt pages and a public `/metrics` page.
- `apps/fx-api`: x402 seller.
  - v2 middleware against the Celo facilitator; accepts USA₮ / USDC / USDT / wARS / wBRL / wCOP.
  - Bazaar metadata; ERC-8004 registration file with x402Support; `arbolito-mcp`.
- `apps/desk`: Stitch config plus a `/fairvalue` feed.
  - Feed inputs: Textile tickers, Uniswap mid/TWAP, dolar refs, an LLM regime flag.
  - Inventory skew; hedger; P&L ledger.
  - Hosting: a buy VM with daily blue/green re-provisioning paid in USA₮, falling back to a VPS.
- Wallets: smart accounts plus session keys (thirdweb on Celo; verify Day 1).
  - Session-key scope: daily cap, per-tx cap, an allowlist (Textile reactor, Permit2, Uniswap router, saved contacts).
  - Anything above the caps needs a Mini App approval.
  - Fallback: per-user server wallets with a $50 cap and confirm-every-tx.

### Capital (estimate; scale to budget)
| Item | Amount |
|---|---|
| Desk inventory | ~$150 USDT + ~$150 wARS + ~$100 wBRL (+ ~$100 cNGN optional) |
| User onboarding credits (Self-gated, first 100) | ~$50–100 |
| buy spend | ~$10–30 |
| LLM and STT | ~$30–50 |
| Gas | negligible |
| **Total** | **~$500** (minimum viable ~$200) |

---

## 3. Day-by-day roadmap (assumes ~10-day window; re-map once the deadline is published)

**Day 0 (Oct 4–5, pre-kickoff: setup only, no product code)**
- [ ] **Email Textile** (contact@textilecredit.com): a live taker key plus filler onboarding for Celo wARS, wBRL and cNGN. Ask how "quoted volume" is measured. *This is the critical path.*
- [ ] Get an x402.celo.org API key.
- [ ] `npx @celo/buy setup`, fund with ~$10 USA₮, buy one browser session and one X search. Note the v1 response shape.
- [ ] Fund the ops wallet. Swap into wARS and wBRL on the Uniswap pools and record slippage.
- [ ] Register for the kickoff; join the Celo dev channels; reserve the Telegram bot handle and a domain.
- [ ] Prepare kickoff questions: deadline? multi-track eligibility? do agent-originated transactions count as adoption? is there a Ripio sandbox or API? where does the attribution code come from?

**Day 1 (Oct 6, kickoff):** confirm the rules.
- Scaffold the monorepo and mainnet config with the attribution tag.
- Register the ERC-8004 agent and Self Agent ID.
- Router v0 with Uniswap quotes plus the Textile feed.
- **Exit:** CLI prints the best wBRL→wARS route.

**Day 2:** connect the routing and receipt pieces.
- Textile v2 RFQ taker flow (preview → firm → execute).
- Multi-hop planner with split routing.
- Deploy `ArbolitoReceipts`.
- **Exit:** first mainnet BRL→ARS conversion with an onchain receipt.

**Day 3:** build the agent and start the desk.
- Smart accounts and session keys.
- Telegram bot plus the Claude tool loop (es/pt/en) and voice notes.
- **Desk v0 live** (Stitch with a simple feed) to start the quoted-volume clock.
- **Exit:** a stranger can onboard and convert from Telegram.

**Day 4:** open to first users.
- Mini App with approvals, receipts and onboarding (Ripio deposit/withdraw paths).
- `/metrics` v0.
- **Soft launch** to 10–20 LatAm testers (Celo Brasil, Colombia, México and Argentina communities) and to the hackathon chat.

**Day 5:** buy depth.
- Browser capture of competitor quotes into the ProofBundle.
- X and Reddit regime signals.
- All buy payments in USA₮.
- Robust handling of v1/v2 and non-402 responses; file an upstream issue or PR.
- Standing rules (payday split, scheduled sends, Textile limit orders).

**Day 6:** open the service to other agents.
- Ship the x402 FX API (USA₮ / wARS / wBRL / wCOP), bazaar metadata, `arbolito-mcp`, and the 8004 file listing endpoints.
- Offer it to other teams.
- Submit the buy listing request.

**Day 7:** Desk v1.
- AI fair-value feed, inventory skew, Uniswap hedging, P&L ledger.
- Move to a buy VM with daily self-renewal paid from desk P&L (blue/green handoff, capped hot wallet).

**Day 8:** hardening and second adoption push.
- Hardening: no_quote, expiry, slippage, partial-route failure, caps, alerts.
- Security pass on keys and session scopes.
- Adoption push #2: Ripio IRL events, LatAm crypto X in es/pt. Collect testimonials and 8004 feedback from real users.

**Day 9:** polish and record.
- Copy and receipt design; README and architecture diagram; a one-pager per track mapping to its rubric.
- Rehearse and record the demo.

**Day 10:** submit.
- Karma project, tweet (@Celo @CeloDevs @RipioHQ @Textileprotocol @usat), video, live links, metrics snapshot.
- **Leave everything running**, since adoption and volume keep accruing until judging.

### Fallbacks and kill-switches
| Trigger | Fallback |
|---|---|
| No Textile key by Day 2 | Uniswap-only routing; escalate through organizers (Textile is a sponsor). The Desk needs credentials, so T2a weakens. |
| Session keys don't work on Celo | Server wallets with caps and per-tx confirmation |
| buy VM egress or lifetime problems | Desk on a VPS; buy stays for data and browsers |
| Competitor pages block the rented browser | Public comparison data (bank rate pages); keep buy for social signals |
| Low human adoption | Lean on agent adoption of the FX API and desk volume; report organic numbers honestly |

### 3-minute demo script
1. **0:00 Hook.** Lucía freelances in Buenos Aires for a São Paulo agency. Getting paid costs her fees and days.
2. **0:20** Portuguese voice note: "manda 2.000 reais pra Lucía". The route card shows Textile firm quotes, Uniswap and a live Western Union capture (from a buy browser), plus savings.
3. **0:50** Approve. One Celo tx and a receipt page with the proof hash. Lucía's phone gets a Spanish message, and the Ripio cash-out path is shown.
4. **1:30** Desk dashboard: quotes, fills and P&L. "Today Arbolito paid for its own server and data, in USA₮, from its own spread."
5. **2:10** Claude Code with `arbolito-mcp`: pay an x402 API in pesos. Show the ERC-8004 identity, Self verification and buy listing.
6. **2:40** Live metrics: users, wFIAT volume, USA₮ settlements, buy calls. Close.

### Submission checklist (confirm at kickoff)
- [ ] Karma project
- [ ] ERC-8004 agentId
- [ ] Self Agent ID
- [ ] Attribution tag on every tx
- [ ] Public repo with README, architecture and rubric map
- [ ] Demo video, 3 minutes or less
- [ ] Live bot, web and API links
- [ ] `/metrics`
- [ ] Tweet with tags
- [ ] Per-track write-ups
