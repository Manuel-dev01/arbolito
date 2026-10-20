# Arbolito Desk: how it quotes, and why

Arbolito Desk is a Textile FX maker on Celo mainnet. It answers RFQs on six corridors against USDT: **wARS, wBRL, wCOP, wMXN, USDC and USA₮**. Stitch, Textile's filler, signs and settles the quotes. Arbolito runs everything around it: the price Stitch quotes from, how much inventory each side may hold, when to stop quoting, and how to get back to a balanced book.

The main idea is that **the feed is the strategy**. Stitch prices an RFQ as a fixed spread around one number per pool. We control that number, so the strategy is a pricing service that gives Stitch, every few seconds, a price that already accounts for fair value, inventory and risk.

- **Live numbers:** [arbolito-livid.vercel.app/desk](https://arbolito-livid.vercel.app/desk) (fills, P&L, inventory, quoting uptime)
- **Raw state:** [desk-feed-production.up.railway.app/state](https://desk-feed-production.up.railway.app/state)
- **Desk wallet:** [`0xBCB8B7dcEB8B39457Ef6D5dC95520A562b13EdbE`](https://celoscan.io/address/0xBCB8B7dcEB8B39457Ef6D5dC95520A562b13EdbE)
- **Textile maker id:** `cmv9mwxsm00a3yx0veu44d0fc`

## Architecture

```
              price sources                     desk-feed (one Railway service)                     Textile
  Textile /price, /tickers ─┐
  dolarapi (crypto, CCL) ───┤   fair value ──► inventory skew ──► breaker ──► /feed/<pair> ◄── Stitch ◄──► RFQ stream
  ER-API, ECB (COP, MXN) ───┼─► (weighted     (lean the mid,     (stale,      (price +          (supervised    (quotes,
  Uniswap pool mids ────────┤    median,       never crossing     disagree,    timestamp)        child; config    fills)
  1.00 peg (stables) ───────┘    outliers out)  fair)              jump)                          regenerated
                                                                                                  every tick)
        risk officer (LLM) ── can only pause a corridor 15–120 min
        inventory caps ────── buy side off at the cap, back on below 80%
        rebalancer ────────── sells above-cap inventory back to USDT (≤ US$ 5 slices, at fair)
        ledger ────────────── fills (from chain), 5-min snapshots (NAV, quoting), RFQs won → Postgres → /desk
```

Stitch runs unmodified as a child process (AGPL boundary respected). It reads our feed over localhost. Only our code and the Stitch binary are inside the service, and the keys reach Stitch through its environment and a `0600` file.

## The strategy, piece by piece

### 1. Fair value from several sources, not one
Each corridor takes a **weighted median** of independent sources and **drops outliers** beyond `maxDevBps` before taking it ([`fair.ts`](../apps/desk/src/fair.ts), [`sources.ts`](../apps/desk/src/sources.ts)):

| Corridor | Sources (weight) | Outlier band |
|---|---|---|
| wARS | Textile `/price` (3), dolarapi crypto (1), dolarapi CCL (1), Uniswap mid (low) | 120 bps |
| wBRL | Textile `/price` (3), official USD/ARS ÷ BRL/ARS cross, Uniswap mid (low) | 150 bps |
| wCOP, wMXN | Textile `/tickers` maker levels (2), ExchangeRate-API (1), ECB via Frankfurter (1) | 150 bps |
| USDC, USA₮ | Textile `/price` (3), a fixed **1.00 peg** (1) | 30 bps |

Fixed-spread fillers quote around Textile's own `/price`. Ours can disagree with it when the rest of the market does, and then it stops quoting instead of being picked off.

### 2. Devaluation-aware peso pricing
The Argentine peso crawls about 1–2% a month, so **holding wARS costs a few bps a day**. The wARS corridor is deliberately asymmetric:
- It **bids 14 bps** under fair (paid to take wARS) and **asks only 5 bps** over (glad to give it).
- Its inventory target is **30% wARS**, against 50% on the other corridors, so the skew below keeps nudging the desk out of pesos.

The other corridors are symmetric: wBRL 6/6, wCOP and wMXN 10/10, USDC and USA₮ 3/3.

### 3. Inventory skew that never crosses fair
Stitch's own inventory lean doesn't reach RFQ quotes, so we lean the **published mid** instead ([`skew.ts`](../apps/desk/src/skew.ts)):

```
d     = clamp((share − target) / band, −1, 1)      share = soft value / corridor value
skew  = −d × maxBps
skew is capped at (sellOffset − floor) when shading down and (buyOffset − floor) when shading up
```

- **Long the soft asset:** the mid shades down, so the desk sells it more readily and buys less.
- **The cap is per direction:** a lean can move the quote toward fair but never past it. The no-crossing property is unit-tested for every inventory level, and `validateCorridor` refuses to start a corridor whose spreads are below the floor.

### 4. A circuit breaker that fails closed
If fewer than two sources agree, a source goes stale, or fair jumps more than `jumpBps` in one tick, the feed **keeps serving its last good timestamp** ([`feed.ts`](../apps/desk/src/feed.ts)). Stitch treats a stale feed as "no price" and stops quoting within `staleness_secs`. A jump has to persist for 30 s before it's believed. The breaker can only stop quoting; it never makes a price.

### 5. Hard inventory caps, and a rebalancer that closes the loop
- **The problem:** Stitch re-offers a side's full size after every fill, so a one-sided taker can keep filling the same side. Early on, the desk bought US$ 40 of wBRL against a US$ 10 sell size.
- **Caps:** each corridor has a hard cap (`maxSoftUsd`, US$ 15–25). At the cap the **buy side is switched off** (the supervisor rewrites Stitch's config and restarts it), and it comes back below 80% ([`limits.ts`](../apps/desk/src/limits.ts)).
- **Buy size follows the room left:** when the buy side is on, it offers only the room left under the cap, in US$ 5 steps (growing a step needs a dollar to spare, so price noise doesn't restart Stitch; shrinking is immediate). Before this, a corridor reopening at US$ 17.6 of wBRL offered its full US$ 20, one fill took it to US$ 37, and the rebalancer had to sell the excess back a few bps under fair. Now one fill can't overshoot the cap.
- **Rebalancer:** a cap alone leaves the excess sitting idle, so the rebalancer ([`rebalance.ts`](../apps/desk/src/rebalance.ts), [`rebalancer.ts`](../apps/desk/src/rebalancer.ts)) sells it back to USDT:
  - **Size:** one slice of at most **US$ 5** every 10 minutes, down to 70% of the cap, so the buy side resumes. It always keeps the corridor's RFQ sell size on hand.
  - **Price floor:** it sells **only within 40 bps of fair** (10 bps for stables), or it holds and logs how far off the market is. The thin wBRL pool can sit far from fair; holding is the right answer then.
  - **No self-trading:** a Textile route is allowed only after the corridor's buy side has been off for 5 minutes, so our own maker can't be on the other side.
  - **Gas in USDT** through Celo's fee abstraction (CIP-64): the desk holds USDT, not CELO.
  - **Safety:** every sale is simulated, tagged with our ERC-8021 attribution, and capped. A failed sale stops the rebalancer and is never retried.

First live sales (2026-10-19): 25.31 wBRL → 4.9994 USDT ([tx](https://celoscan.io/tx/0xfd5f56f13697844b5cb78c605e1d0575ec41de406927435314f1c42ff1de481e)) and 25.28 wBRL → 4.9969 USDT ([tx](https://celoscan.io/tx/0x3151eef061ca86eb37153ecfdc1ee0e9c6d5dd0066ea4c29f52e3e3ec3055ead)), both at fair. Both are type `0x7b` (gas paid in USDT).

### 6. An LLM risk officer that can only say "stop"
Every 15 minutes a model (DeepSeek, tool call forced, thinking off) reads per-corridor signals ([`risk.ts`](../apps/desk/src/risk.ts)):
- the hour's price move and volatility
- source dispersion, set against the breaker's own tolerance
- breaker holds
- the inventory share
- fills and their edge

It returns *normal* or *pause 15–120 min* per corridor. **It can't change a price, a spread or a size.** The worst it can do is quote less.

What running it taught us (2026-10-19), and what changed:
- **A self-renewing pause:** a paused corridor reports "hold" every tick, and those holds were counted as breaker holds. The officer read them as an unstable market and paused again, which kept wBRL off for about 10 hours. Now only the breaker's own holds count, with a regression test.
- **Over-pausing:** it then paused on 40–52 bps of source dispersion, which is normal for pesos. Its signals now include each corridor's breaker tolerance, and its instructions say a pause costs scored volume. The first review after the change returned *normal* for all six corridors, with correct reasons.

### 7. Corridors chosen for where the market is thin
- **Stablecoins (USDC, USA₮) and the depeg guard:** their fair value combines Textile's price with a fixed **1.00 peg** inside a 30 bps band. If a stablecoin drifts off its peg, the sources disagree, the breaker trips and the desk stops quoting it. The disagreement itself is the depeg alarm.
- **wMXN starts bid-only:** nobody on Textile was buying wMXN for USDT when we started (`USDT_MXN` had no bid), so the whole allocation sits on the buy side. The sell side fills only from what the desk has bought.
- **wCOP and wMXN have no Uniswap pool and no Textile `/price`:** their fair value comes from Textile's own ticker levels cross-checked against two daily FX references.

## Results so far (honest)
- **Fills:** 6, about US$ 90 executed, against independent takers and the RFQs our app's users send through Textile (the organisers confirmed those count).
- **Edge at fair:** between −0.01% and +0.06% per fill. Five are at or above fair; one (2026-10-20) is 1 bp under, because fair moved between quote and fill. Spread earned so far is a few cents.
- **NAV:** about US$ 120.2 against **120 USDT** of capital (three 40 USDT deposits).
- **The first inventory cost us:** the initial wBRL was bought on the thin Uniswap pool, above fair. Later inventory comes through the bid side.
- **RFQ flow on these corridors is thin.** That's why uptime matters: a corridor that's quoting is ready when flow arrives. `/desk` shows uptime per corridor over 24 h and 7 days, measured every 5 minutes.
- **Win rate isn't observable from our side.** Stitch logs only the RFQs our quote *won*, not the ones it answered and lost. `/desk` counts the wins it can see; we don't publish a win rate we can't measure.

## How to verify
1. **Fills:** USDT and soft-token transfers into and out of the desk wallet, settled through Textile's settlement contract. The ledger indexes them from chain ([`ledger.ts`](../apps/desk/src/ledger.ts), [`fills.ts`](../apps/desk/src/fills.ts)).
2. **Every transaction the desk sends carries our ERC-8021 attribution code `celo_e054d92430a5`:** approvals and rebalancing swaps. Fills are settled by the taker.
3. **Parameters:** [`corridors.ts`](../apps/desk/src/corridors.ts) holds every spread, cap, source and band. The Stitch config is generated from it ([`stitch-config.ts`](../apps/desk/src/stitch-config.ts)).
4. **Tests:** 41 unit tests under `apps/desk/test`:
   - fair value
   - skew bounds
   - the breaker
   - caps
   - rebalance slices
   - risk parsing and bounds
   - the pause-loop regression
   - the RFQ log parser

   The rebalancer was also rehearsed on an anvil fork of Celo mainnet before going live.

## Code map
| File | What it does |
|---|---|
| [`apps/desk/src/corridors.ts`](../apps/desk/src/corridors.ts) | Every corridor's spreads, caps, sources, bands and skew; refuses unsafe configs |
| [`sources.ts`](../apps/desk/src/sources.ts), [`fair.ts`](../apps/desk/src/fair.ts) | Price observation and the weighted median with outlier rejection |
| [`skew.ts`](../apps/desk/src/skew.ts), [`feed.ts`](../apps/desk/src/feed.ts) | Inventory lean and the circuit breaker |
| [`server.ts`](../apps/desk/src/server.ts) | The feed service: ticks, `/feed/<pair>`, `/state`, risk reviews, snapshots |
| [`supervisor.ts`](../apps/desk/src/supervisor.ts), [`stitch-config.ts`](../apps/desk/src/stitch-config.ts) | Stitch as a supervised child; its config regenerated from the strategy |
| [`limits.ts`](../apps/desk/src/limits.ts), [`rebalance.ts`](../apps/desk/src/rebalance.ts), [`rebalancer.ts`](../apps/desk/src/rebalancer.ts) | Caps, and selling above-cap inventory back to USDT |
| [`risk.ts`](../apps/desk/src/risk.ts) | The pause-only LLM risk officer |
| [`ledger.ts`](../apps/desk/src/ledger.ts), [`fills.ts`](../apps/desk/src/fills.ts), [`rfq-log.ts`](../apps/desk/src/rfq-log.ts) | Fills from chain, snapshots, RFQs won |
| [`scripts/desk-feed.ts`](../scripts/desk-feed.ts) | Wires it all together in one process |
