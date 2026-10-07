# 05: Demo, submission and adoption playbook

## 3-minute demo script
| Time | Beat | On screen |
|---|---|---|
| 0:00 | **Hook.** "Lucía freelances in Buenos Aires for a São Paulo agency. Getting paid costs fees and days. Watch." | Title card + Telegram |
| 0:15 | Portuguese **voice note** from the agency: "manda 2.000 reais pra Lucía em Buenos Aires" | Telegram, voice bubble |
| 0:25 | **Route card.** Textile firm quotes vs Uniswap vs a **live Western Union capture** from an agent browser rented on buy (thumbnail), plus savings | Route card |
| 0:45 | Tap **Confirmar**. One Celo tx. Receipt page with the proof hash. Lucía's phone gets a Spanish message, and the Ripio cash-out path is shown | Receipt `/r/:id`, Celoscan |
| 1:20 | "Arbolito also **is** a market maker." `/desk`: quotes on Textile wARS/wBRL/cNGN, fills, P&L. "Today it paid for its own server and data, in USA₮, from its own spread" | `/desk` with tx links |
| 2:00 | "**Agents can hire it.**" Claude Code + `arbolito-mcp`: "pay this x402 API in pesos". Show the ERC-8004 card, Self verification and the buy listing | Terminal |
| 2:35 | **Live metrics**: users, wFIAT volume, USA₮ settlements, buy calls, desk quoted volume. Close: "An arbolito for every agent and every peso." | `/metrics` |

Rules:
- Record on mainnet with real funds. No mocked screens.
- Pre-warm the quotes. Keep a backup recording of each beat.
- Subtitle the es/pt parts in English.

## Submission checklist (confirm exact requirements on the hub)
- [ ] Hub registration done; attribution code received and set as `ATTRIBUTION_CODE`
- [ ] Karma project page (description, team, links, milestones)
- [ ] ERC-8004 agentId (registration JSON lists the fx-api endpoints and `x402Support: true`)
- [ ] Self Agent ID verification
- [ ] Public GitHub repo:
  - [ ] README with architecture diagram
  - [ ] per-track rubric map
  - [ ] how to run
  - [ ] contract addresses
- [ ] Demo video ≤ 3 minutes (YouTube/Loom), with English subtitles
- [ ] Live links: Telegram bot, web app, `/metrics`, `/desk`, FX API base, MCP install line
- [ ] Deployed contract addresses (ArbolitoReceipts) and verified source on Celoscan
- [ ] Tweet tagging @Celo, @CeloDevs, @RipioHQ, @Textileprotocol, @usat, with the Karma link and agentId
- [ ] Per-track write-ups (templates below), one per track entered
- [ ] Systems left running after submission; metrics keep accruing

## Per-track write-up templates

### T1 Stable Agents: LatAm (functionality · utility · UX · onchain adoption)
- **Problem:** Argentines paid in USD lose ~4% at the official rate; BRL⇄ARS transfers need SWIFT and days.
- **What works today, on mainnet:** convert, send, cross-border BRL→ARS, receipts, rules. Link the tx hashes.
- **UX:** chat and voice in es/pt, one-tap confirm, receipts anyone can verify.
- **Adoption (as of {date}):**
  - {N} wallets and {N} transactions
  - {$} wARS and {$} wBRL volume
  - {N} cross-border sends
  - {N} agent callers via the FX API

  Link `/metrics`.

### T2a Open Corridors: Textile (quoted volume · profit · innovation)
- **Taker flow:** {$} routed through Textile RFQ on wARS/wBRL, corridors that had ~$0–300/day before.
- **Arbolito Desk:**
  - {$} quoted volume and {N} fills
  - P&L {$} after costs
  - corridors: wARS, wBRL, cNGN
- **Innovation:**
  - AI fair-value feed driving Stitch
  - LLM regime risk officer
  - Uniswap hedging
  - self-funded compute on buy

### T2b Open Corridors: USA₮ (real USA₮ settlements)
- **USA₮ is the treasury dollar.** {N} x402 settlements in USA₮ ({$}): buy purchases (browsers, data, VMs) and FX API sales. Settlement tx list linked.

### T3 Build with buy (problem · integration depth · demand for buy)
- **Problem:** proving best execution needs competitor quotes that have no API. A self-hosting desk needs compute and market signals.
- **Integration depth:**
  - browser rentals, social data and VMs (daily self-renewal)
  - x402 v1 handled alongside v2
  - quote-before-pay and no-blind-retry
  - upstream issue/PR filed (link)
  - our FX service submitted for listing
- **Demand created:** {N} paid calls / {$} to date; projected {N}/day at {users}.

## Adoption campaign (T1 "onchain adoption")
**Principles**
- Start early: soft launch on Day 4.
- Show only organic numbers.
- Gate incentives with Self, so they can't be farmed.

| When | Channel | Action |
|---|---|---|
| Day 3–4 | Hackathon Discord/Telegram | Offer the FX API and MCP to other teams ("need wARS↔USD for your agent? one call") |
| Day 4 | Celo LatAm communities (Celo Brasil, Colombia, México, Argentina), LatAm crypto X | Launch posts in es/pt; first-100 offer: fee-free first transfer + a small wARS/wBRL starter credit for Self-verified humans |
| Day 5–8 | Ripio IRL builder events in Argentina | Ask organizers to share the bot; demo to attendees |
| Day 6–9 | Freelancer communities (AR/BR devs paid in USD) | "Cobrá en USD, gastá en pesos al mejor precio, con recibo" |
| Ongoing | `/metrics` | Post daily screenshots; reply to every user |

**Starter-credit budget:** ~$50–100 total (e.g. ARS 1,000 ≈ $0.62 or R$3 ≈ $0.57 per verified user). It's paid only after the user's first self-initiated action.

**Tracking:** attribution code on every tx; a UTM parameter per channel in bot deep links (`t.me/ArbolitoBot?start=src_celobr`).
