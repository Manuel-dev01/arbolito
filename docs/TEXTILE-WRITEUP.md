# Arbolito Desk: write-up for Textile FX

**Maker wallet:** [`0xBCB8B7dcEB8B39457Ef6D5dC95520A562b13EdbE`](https://celoscan.io/address/0xBCB8B7dcEB8B39457Ef6D5dC95520A562b13EdbE) · **Maker id:** `cmv9mwxsm00a3yx0veu44d0fc` · **Live:** [arbolito-livid.vercel.app/desk](https://arbolito-livid.vercel.app/desk) · **Full strategy:** [DESK-STRATEGY.md](DESK-STRATEGY.md)

Six corridors against USDT on Celo: **wARS, wBRL, wCOP, wMXN, USDC, USA₮.** Stitch runs unmodified; everything new is in the price we feed it and the risk layer around it.

## What's new in how it prices and manages risk

1. **The feed is the strategy.** Stitch quotes a fixed spread around one number per pool. We own that number and recompute it every 10 s from fair value, inventory and risk, so a stock Stitch behaves like an inventory-aware, risk-aware maker.
2. **Fair value that can disagree with Textile.** A weighted median of independent sources (Textile `/price` or `/tickers`, dolarapi crypto/CCL, the official BRL cross, ER-API, ECB, Uniswap mids), with outliers dropped. When too few sources agree, the feed stops updating and Stitch stops quoting. Fixed-spread fillers quote around Textile's own price; we quote only when the wider market backs it.
3. **Devaluation-aware peso spreads.** The peso crawls 1–2% a month, so holding wARS has a carry cost. wARS bids 14 bps under fair and asks 5 over, and targets only 30% of the corridor in pesos.
4. **Inventory skew that never crosses fair.** The published mid leans against inventory, capped per direction at spread minus a floor, so no quote is ever better than fair for the taker. This is unit-tested at every inventory level.
5. **A fail-closed breaker, plus a peg used as a source for stablecoins.** Stale sources, disagreement, or a jump that hasn't persisted for 30 s all freeze the feed. For USDC and USA₮, a fixed 1.00 peg is one of the sources within a 30 bps band, so a depeg trips the breaker on its own.
6. **Hard caps sized to the room left, and a rebalancer that never trades against itself.** At its cap a corridor's buy side switches off, and the buy size only offers the room left under the cap. The rebalancer sells the excess back at no worse than 40 bps from fair, in ≤ US$ 5 slices. It only routes through Textile after our own buy side has been off for 5 minutes, so our maker can't be the one filling it.
7. **An LLM risk officer that can only say "stop".** Every 15 minutes a model reads moves, volatility, dispersion, holds, inventory and fill edge, and may pause a corridor for 15–120 minutes. It can't touch a price, spread or size.

## It worked when it mattered (2026-10-26)
On 2026-10-26, Textile priced wBRL at **5.445 BRL/USDT**, while ECB (5.05), ER-API (5.00) and the official cross (4.98) disagreed by about 9%, and the Celo Uniswap wBRL pool had been drained to its last tick. Our breaker held wBRL ("sources disagree") for the whole dislocation, so the desk **didn't buy into it**. The next day the market settled at 5.32, the corridor came back on its own, and its first fill was at 5.3156, **3.6 bps better than fair** ([tx](https://celoscan.io/tx/0xb6a5c4c16265a3e088b6bd7851249b770b1eb05374253caa9e8db356d677c649)). The same day, the risk officer paused wARS after a 100 bps move.

## Fills (all 13, every one against an independent taker)
None of these settlements touches any wallet we control: ops, desk, buy payer, anchor, operator or the founder's MiniPay wallet were all checked onchain against each tx's transfers. Inventory top-ups came through Uniswap, never through Textile.

| Date (UTC) | Pair | Desk | USDT | Edge vs fair | Tx |
|---|---|---|---|---|---|
| 10-15 17:08 | wBRL | sold | 9.87 | +6.0 bps | [0x27d4…9d2d](https://celoscan.io/tx/0x27d4ee6758a90f58881bdb16e3e546c09d16fe6edfbe252d418e4f4877779d2d) |
| 10-17 07:43 | wBRL | bought | 0.43 | +2.0 | [0x3838…cd43](https://celoscan.io/tx/0x38387b5e75cb2edf673c35a1d159b47818a0ce754d251c7c471f794d8bf5cd43) |
| 10-17 07:44 | wBRL | bought | 19.57 | +2.0 | [0x759e…20c8](https://celoscan.io/tx/0x759eb3191bd9087d807222a4186e95cb47e5b3865e5b7eb88d95c33ee87420c8) |
| 10-18 22:40 | wBRL | bought | 20.00 | +0.1 | [0x525b…2c87](https://celoscan.io/tx/0x525bcab974b53698cd58769933a465ddfb39f608efa6423b3d74240c65f52c87) |
| 10-19 20:45 | wBRL | bought | 20.00 | +1.0 | [0x03df…c524](https://celoscan.io/tx/0x03df13fffd9bf58b569b5128810e53c8e55945e6326b3d732e355c76c745c524) |
| 10-20 13:22 | wBRL | bought | 20.00 | −0.8 | [0x7e65…155b](https://celoscan.io/tx/0x7e659af26e586e10a8cfdfed03a1945958edbce4a5f1c51405026a21c69f155b) |
| 10-20 19:18 | wBRL | sold | 9.94 | −0.4 | [0x9833…2f98](https://celoscan.io/tx/0x9833a3d93d5b4d86cf24765e10caa547ef50c3716e3a44e609eb8ada5c6b2f98) |
| 10-20 21:47 | wBRL | sold | 9.93 | +4.7 | [0x5d39…69bf](https://celoscan.io/tx/0x5d393a142249ab022b840061c1aff9aa7489cbb65db83aed45f80fff21ab69bf) |
| 10-26 16:21 | wARS | sold | 7.99 | −2.7 | [0x60ab…8ba3](https://celoscan.io/tx/0x60ab4f2acea5424cef2d23570faf1a8f8b98ccd37c3503f41574283a79268ba3) |
| 10-26 16:23 | wARS | sold | 0.86 | +10.1 | [0x9ed8…a6f5](https://celoscan.io/tx/0x9ed8ba5b162e96b355e6dce30f7cc646e23b4168c20d9edc589dbc1e38bfa6f5) |
| 10-26 18:46 | wARS | sold | 0.56 | +18.5 | [0xca35…e87a](https://celoscan.io/tx/0xca351a003354a2d5091f3af3ee5dd41ec938d743bdded128ef7192871316e87a) |
| 10-26 18:49 | wARS | sold | 0.23 | +17.3 | [0x548c…ff3e](https://celoscan.io/tx/0x548c5184d18af13a83a2d6e7203502f8e54c0f45fee9553362a9a78e4b43ff3e) |
| 10-27 14:21 | wBRL | bought | 10.00 | +3.6 | [0xb6a5…c649](https://celoscan.io/tx/0xb6a5c4c16265a3e088b6bd7851249b770b1eb05374253caa9e8db356d677c649) |

Edge is measured against the feed's fair price when the fill landed; a negative value means fair moved between the quote and the fill.

## P&L (2026-10-27)
| | US$ |
|---|---|
| Capital in (four 40 USDT deposits) | 160.00 |
| Value now (inventory at fair) | 159.12 |
| **Result** | **−0.88 (−0.55%)** |
| of which: spread earned on fills | **+0.02** (≈ +1.4 bps on US$ 129) |
| of which: inventory marked to fair, and the first inventory bought on Uniswap above fair | ≈ −0.90 |

The trading itself is positive. The loss comes from holding inventory: mostly the wBRL the desk bought around 5.03–5.08 BRL/USDT, now marked at 5.32 (the real fell 5–6% against the dollar), plus the first inventory, which was bought on a thin Uniswap pool. Gas is paid by a separate ops wallet and isn't in these numbers.

**What we'd change with more time:** the skew target per corridor should follow carry (wBRL moved too), and the cap should shrink when the fair-value sources disperse, not only when they disagree.
