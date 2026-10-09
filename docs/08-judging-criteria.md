# 08: Official judging criteria (canonical)

Source: the Loops House event skill (`loops add agents-on-open-rails`, CLI v0.6.0, fetched 2026-10-09), installed at `.claude/skills/loops-agents-on-open-rails/SKILL.md`. Some descriptions are truncated there ("…"). `loops evaluate -e agents-on-open-rails -s <sponsor>` (signed in) returns the full text. Re-run `loops add agents-on-open-rails --yes` to refresh.

- **Submission and registration deadline: Nov 9, 2026, 09:00 UTC** (event timezone Africa/Abidjan = UTC).
- **Prizes:** $5,000 total.
- **Scoring rule:** every track is scored on real onchain activity, verified through the project's **attribution tag** (`celo_e054d92430a5`).

## T1 Stable Agents: LatAm (Ripio × Celo Core Co.): 🥇 $1,500 · 🥈 $500
1st place: "an agent live on Celo mainnet that charges, pays, saves, swaps or settles in a Ripio wFIAT token, with **real users in Latin America** and a clear path to grow after the hackathon."

| Criterion | Weight | What it asks |
|---|---|---|
| Works on mainnet with a real wFIAT token | 20% | Runs on Celo mainnet and moves real wARS/wBRL/…; usage verified via the attribution tag; core flow live with real txs by the deadline |
| Real use of wFIAT and the Celo stack | 20% | wFIAT at the heart of the product; meaningful use of ERC-8004, x402 via Celo's facilitator, gas paid in stablecoins… |
| Agent autonomy and usefulness | 20% | Takes real actions on its own; saves a **named** person or business time or money; clear decision logic and guardrails |
| UX a real person can use | 20% | Someone new to crypto completes the core flow end to end; amounts in the user's own currency; the rails stay out of the way |
| Impact for LatAm | 20% | A real money need; names who it's for; real users or a credible path to them |

## T2a Open Corridors: Textile FX: 🥇 $750 · 🥈 $250
1st place: "a **quoting strategy** live on Textile FX on Celo mainnet with the strongest P&L, meaningful volume quoted and filled, and an original approach to pricing, risk, or treasury management."

| Criterion | Weight | What it asks |
|---|---|---|
| Strategy P&L | 40% | Measured onchain from the filler's Celo mainnet fills over the window, vs today's fixed-spread fillers; steady and risk-aware beats one lucky trade |
| Volume quoted and filled | 30% | Quotes answered and filled, and competitive-quote share, on cNGN/wARS/wBRL/IDRX/USDC vs USD₮. **Independent traders' fills count; self-trading does not** |
| Originality | 30% | Inventory-aware pricing, FX risk management, capital efficiency, flow-adaptive strategies; clear reasoning in the repo |

The Celo Developers announcement (2026-10-09) adds:
- **Corridors:** cNGN, IDRX and Ripio wFIAT against USD₮.
- **Suggested directions:**
  - pricing that adapts to your inventory
  - FX risk management across corridors
  - quoting that does more with less capital
  - **a treasury bot that quotes to manage a business's own currency exposure, rather than to earn the spread**

The last one maps well onto Arbolito Desk: its quoting can be driven by the inventory Arbolito needs for user conversions, not just spread.

## T2b Open Corridors: USA₮ with x402: 🥇 $750 · 🥈 $250
1st place: "real users whose value flows through USA₮ settling over Celo's x402 facilitator on mainnet, with a **named counterparty outside the team**, **repeat payments**, and a clear reason USA₮ fits that user."

| Criterion | Weight | What it asks |
|---|---|---|
| Real settlement on mainnet | 25% | USA₮ settles through **Celo's x402 facilitator**, verified via the attribution tag |
| A named counterparty outside the team | 25% | An identifiable independent person, business or agent; the submission names them and what they pay for |
| Repeat flow from the same counterparty | 25% | The same counterparty pays again over the window |
| Why USA₮ matters to that user | 25% | Why a US-regulated dollar fits; made simple (e.g. Self verification, gasless x402) |

## T3 Build with buy: 5 × $200
"Products that solve a real problem for a **named user** by paying for services and agents they don't own over x402 on Celo mainnet, with **verified paid calls from the project's tagged wallet** and new demand for the agents consumed."

| Criterion | Weight | What it asks |
|---|---|---|
| Use case quality and the problem solved | 40% | A task a named person or business does today; what it costs them now; what changed. The user shouldn't need to know Celo or x402 |
| Depth of the integration | 35% | The core product consumes ≥ 1 x402 service or listed Celo agent the team doesn't own, through buy or another x402 client; counted as verified paid calls from the tagged wallet |
| Demand created for the agents consumed | 25% | New paying counterparties and transactions from real users of the product |

## What this changes for Arbolito
1. **The Desk is the whole T2a entry.** T2a scores a *filler's* quoting P&L, volume and originality. Routing taker flow through Textile doesn't score there directly, so Desk v0 should go live early to start the P&L and volume clock. Self-trading is excluded, so Arbolito's own taker flow hitting its own desk doesn't count.
2. **Named users and counterparties are explicit criteria** in T1, T2b and T3. The submission must name real people or businesses, so plan outreach to real LatAm users and at least one independent agent or business that pays the FX API repeatedly in USA₮.
3. **Tag every wallet that should score.** Ops, desk and buy-payer txs all carry the code. x402 settlements are tagged by the facilitator only after x402-rs#99 ships, and judges credit x402 by `payTo` until then.
4. **T1 UX:** a crypto-new user must finish the core flow with amounts in their own currency. That validates the Telegram + Mini App plan; keep crypto terms out of the copy.
5. **T1 "Celo stack":** ERC-8004 identity, x402 via Celo's facilitator and **gas paid in stablecoins** are named. Exercise the `--fee-currency USDT` path on mainnet (it's built, but has never run on mainnet).
