# Arbolito Desk: Textile maker scope (2026-10-15)

Track: **Stable Agents: Open Corridors | Textile FX** ($750 / $250).
Judged on **strategy P&L 40%** (onchain fills over the window, vs fixed-spread fillers; steady beats lucky), **volume quoted and filled 30%** (fills from independent traders; self-trading doesn't count), **originality 30%** (inventory-aware pricing, FX risk, adaptive strategies; reasoning written in the repo).

## What Stitch gives us (read from textile-protocol/textile-stitch, AGPL-3.0, 2026-10-13)
- **The filler engine.** Holds a WebSocket to Textile RFQ, signs firm quotes (Permit2 orders, exclusive, single-use, Textile-set TTL) only up to what the wallet can cover, and keeps a ledger of reserved quotes.
- **Pricing input is one HTTP feed per pool:** `GET → {"price": <stable per soft>, "timestamp": <unix>}`. Stale feed (age > `staleness_secs`) means no quotes.
- **RFQ quotes use only the configured spreads (`buy_offset_bps` / `sell_offset_bps`) and per-side liquidity caps.** Stitch's inventory lean and TWAP apply to the public ladder only. The newer "FX protection modules" (inventory skew, dynamic spreads) do reach RFQ quotes, but only for an OperatorVault-funded bot (vaults are beta; Textile says the flow is rough).
- **Runs as a container:** `ghcr.io/textile-protocol/textile-stitch`, with config and keys via env (`STITCH_CONFIG_TOML`, `STITCH_PRIVATE_KEY`, `STITCH_RFQ_API_KEY`).
- **Maker key:** `stitch connect` signs with the operator wallet; Textile then emails a verification link. The credential covers every RFQ corridor on every chain.
- Textile's own feed exists: `https://api.textilecredit.com/price?chainId=42220&pair=wars-usdt` (2026-10-15: 0.00062023 USDT/wARS ≈ 1,612 ARS/USDT; wBRL 0.19798 ≈ 5.05 BRL/USDT).

## Design: the feed is the strategy, Stitch is the execution
Stitch stays unmodified, in its own process (no AGPL entanglement). Arbolito serves the feed Stitch prices from, and the feed carries the strategy:

1. **Fair value from independent sources.** Textile `/price`, dolarapi (cripto/MEP for ARS; official USD/BRL), and Uniswap pool mids (thin, so a low weight; used mainly as an arbitrage alarm). Take a weighted median and reject outliers.
2. **Inventory skew in the mid.** RFQ ignores Stitch's lean, so we lean the published mid by the desk wallet's inventory share `x`: `mid × (1 − k·(x − target))`, with `|skew| < spread − floor` so no quote ever crosses fair. Long wARS → mid shades down: we sell wARS more readily and buy less.
3. **Circuit breaker.** If the sources disagree by more than N bps, a source is stale, or the price jumps more than M bps in one tick, the feed serves its last good timestamp. That goes stale within `staleness_secs`, and Stitch stops quoting. This is the "don't get picked off" rule.
4. **Hedge and rebalance.** Outside the inventory band, the existing router rebalances through Uniswap, or through Textile as a taker, but never into our own quotes. Every tx goes through `sendGuarded`, so it is capped and carries the attribution tag.
5. **Risk officer (P1).** The existing DeepSeek risk officer reads regime signals and can only widen or pause: change the spreads with a Stitch restart, or trip the breaker. It never tightens below the floor.
6. **Ledger and `/desk`.** Read fills from the reactor's events for the desk maker address, and mark-to-market P&L against the feed. Publish quotes, fills, inventory and P&L on the existing `/desk` page. This doubles as the "reasoning in the repo" for the originality score.

## Money and safety
- **Desk wallet `0xBCB8…EdbE` (`DESK_PRIVATE_KEY`).** Only capped float lives there. `DESK_MAX_INVENTORY_USD` (500) is a ceiling, not a target.
- **Inventory is capital at risk, not spend.** Stitch caps each side with a fixed liquidity (never `"max"`), and the wallet holds only what we fund.
- **Permit2 approvals:** send them ourselves through `sendGuarded` with exact amounts and the attribution tag, rather than `stitch approve` (untagged, max allowance).
- **Gas:** a few cents of CELO for the approvals. Fills are executed and paid for by takers.
- **Rollout:** `--dry-run` against our feed first (no firm quotes), then live with small caps, then larger caps only with the founder's approval.

## Founder decisions needed before anything live
1. **Inventory size per corridor.** PLAN.md says about $150 USDT + $150 wARS + $100 wBRL. Proposed start: **$40 USDT + $20 wARS + $20 wBRL**, scaled up after a clean week.
2. **Textile registration.** `stitch connect` registers the desk wallet as a maker and sends a verification email, which needs your email.
3. **Hosting.** A new Railway service next to the bot, possibly extra cost. The PLAN's buy-VM self-hosting is a P1 option.
4. **Organisers' read on our own app's users** hitting the desk through Textile RFQ. They are real independent users, but worth confirming that doesn't count as self-trading.

## Build order (no money needed until step 4)
1. `apps/desk`: the feed service (sources, median, skew, breaker), with unit tests and a `GET /api/desk/feed?pair=` endpoint.
2. The Stitch config generator (`stitch.toml` per corridor: pools, `feed_url`, fixed caps, spreads).
3. Local Stitch in `--dry-run` against the feed; a log review.
4. **With approval:** fund the desk wallet, tagged exact Permit2 approvals, `stitch connect` plus your email verification, go live with small caps.
5. Fills indexer, P&L ledger, `/desk` page live; then the risk officer and rebalancing.
