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
8. **Carry-aware inventory targets (live 2026-10-27).** Each currency corridor measures how fast its currency is losing value against the dollar, from a week of the desk's own fair prices. It takes one median per day and then the Theil–Sen slope across days, so a dislocated day doesn't count. That measurement is blended with a prior by how much history it has. The share of inventory the corridor aims to hold in that currency falls as the carry rises, and the skew leans the quotes toward it. On launch the targets were wARS 20%, wBRL 27%, wCOP 37% and wMXN 41%: the desk now holds less of whatever has been devaluing. The peso's prior reproduces the old hand-tuned 30%.
9. **Buy caps that shrink before the breaker trips (live 2026-10-27).** Disagreement between sources stops quoting outright. Before that point, sources drifting apart already means fair is less certain, so each corridor's buy cap scales with smoothed source dispersion. It stays whole up to 30% of the breaker's band, then steps down to 75%, 50% and 25% by 90% of it. Only buying is cut. The rebalancer keeps the static cap, so an uncertain hour never forces a sale. Both values are shown live per corridor on `/desk`.
10. **Sizes clamped to the live Permit2 allowances (live 2026-11-02).** Every fill spends the desk's Permit2 allowance, and Stitch refuses to start when one is under what it is configured to trade: on 2026-11-01 that kept the desk dark for 17 hours. The feed now reads the allowances every minute and clamps each sell side and the summed buy sides to them, so a spent approval shrinks the quotes and raises an alert instead of stopping the desk.
11. **Independent sources so two can't hold a corridor (live 2026-11-02).** Over a weekend the official BRL cross went stale and the thin Uniswap pool (5.32) and Textile (5.45) disagreed past the breaker. ER-API and the ECB were added for wBRL; they sided with Textile, so the median prices the real and drops the pool as the outlier.

## It worked when it mattered (2026-10-26)
On 2026-10-26, Textile priced wBRL at **5.445 BRL/USDT**, while ECB (5.05), ER-API (5.00) and the official cross (4.98) disagreed by about 9%, and the Celo Uniswap wBRL pool had been drained to its last tick. Our breaker held wBRL ("sources disagree") for the whole dislocation, so the desk **didn't buy into it**. The next day the market settled at 5.32, the corridor came back on its own, and its first fill was at 5.3156, **3.6 bps better than fair** ([tx](https://celoscan.io/tx/0xb6a5c4c16265a3e088b6bd7851249b770b1eb05374253caa9e8db356d677c649)). The same day, the risk officer paused wARS after a 100 bps move.

On 2026-10-28 it caught adverse selection: a small wARS sale filled 9 bps worse than fair, and the officer paused the corridor ("being picked off by better-informed flow"). What happened next is part of the design story. Because the officer was shown its own pause reason, it kept renewing the pause for 10 hours after the fill had left its one-hour window. We changed two things:
- **What the officer sees:** it is told only how long a corridor has been paused, never why. A past reason is not evidence.
- **A cap in code:** no corridor stays paused more than 120 minutes in a row, and after the cap it can't be re-paused for one review interval.

Both are regression-tested. A model can call for a pause, but code limits how long it lasts.

## Fills (all 89 as of 2026-11-08)
89 fills from 2026-10-15 to 2026-11-08: US$ 594.27 of volume, 66 on wARS, 19 on wBRL, 3 on USA₮ and 1 on USDC, with 19 counterparty wallets. Every one is listed here with its transaction, and live at [/desk](https://arbolito-livid.vercel.app/desk). The desk won 160 RFQs over the same period (Stitch's log since 2026-10-20).

| Date (UTC) | Pair | Desk | USDT | Edge vs fair (bps) | Tx |
|---|---|---|---|---|---|
| 10-15 17:08 | wBRL | sold | 9.87 | +6.0 | [0x27d4…9d2d](https://celoscan.io/tx/0x27d4ee6758a90f58881bdb16e3e546c09d16fe6edfbe252d418e4f4877779d2d) |
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
| 10-27 20:16 | wARS | bought | 10.00 | −0.6 | [0xc07e…a94f](https://celoscan.io/tx/0xc07e18f3e927b1b7ef1cdbd3ce3499f86819e6962aae0c4b6327fe4f2026a94f) |
| 10-27 21:11 | wARS | sold | 9.69 | −0.4 | [0x8cfd…27a6](https://celoscan.io/tx/0x8cfd6965987454722d0f3660f751b57f1152a3cdac5e0a42592e7e52b87627a6) |
| 10-28 02:26 | wARS | sold | 0.30 | −9.0 | [0xf7c7…7f70](https://celoscan.io/tx/0xf7c702180e817c022d90bf710f34c1760bf1d107c795c52094a70e37b4537f70) |
| 10-28 13:40 | wARS | bought | 10.00 | +4.8 | [0xee63…cdde](https://celoscan.io/tx/0xee63a6691a44be428c5e1923a2c433dfafcc411bf2c85eacd6fea77bf237cdde) |
| 10-28 13:47 | wARS | sold | 9.72 | +2.0 | [0xbaf9…0c84](https://celoscan.io/tx/0xbaf940c8505cc3c8a566774f557832b338da574dfbc5c7868e39f7e2559c0c84) |
| 10-28 16:20 | wARS | bought | 10.00 | −1.0 | [0x5bec…56e0](https://celoscan.io/tx/0x5bec1dabe8c8ae4cdc174c18c8eac9f91aeaa469f54e8364669482228d2656e0) |
| 10-28 17:49 | wARS | sold | 9.68 | +0.6 | [0x616e…3220](https://celoscan.io/tx/0x616e492c135144892f1c21ab0d1979b76aa086e7f7b2c73424d8f2291b9f3220) |
| 10-28 17:55 | wARS | bought | 10.00 | +0.4 | [0xfb97…837f](https://celoscan.io/tx/0xfb97739e41161cea8e98fe43547dfd384df44de664de923bdb1bc1971475837f) |
| 10-28 18:28 | wARS | sold | 9.66 | −4.9 | [0x288b…e276](https://celoscan.io/tx/0x288b43aacacc3c13f540ff6bb35f909ee82d07803cf9413695d85e523d33e276) |
| 10-28 18:40 | wARS | sold | 0.02 | +9.5 | [0x300b…edab](https://celoscan.io/tx/0x300baa9bee090fe46fa83231955c0d409cab4791da7f3f1913bc7c871c62edab) |
| 10-28 19:22 | wARS | sold | 0.89 | −10.4 | [0x2b85…52d3](https://celoscan.io/tx/0x2b8504aa68906a565e91a221cd7cef8853652e662ebac4c8ae811ad8560952d3) |
| 10-29 22:51 | wARS | bought | 10.00 | +4.5 | [0x9074…22bf](https://celoscan.io/tx/0x90741a858cfce1ca939c6d280cfa0358b849060eb6abbb46382dfbf72c6622bf) |
| 10-29 23:42 | wARS | sold | 9.75 | +1.9 | [0x944b…acf3](https://celoscan.io/tx/0x944b755cb9e70ff5204747916d63274c3e32ea9f67edd6bf65dbe9ab12f9acf3) |
| 10-29 23:45 | wARS | bought | 10.00 | +7.2 | [0x2c54…3cc6](https://celoscan.io/tx/0x2c54f42945b0dd957df621ee25ef90232d82e44df40f9d80aab957a0c8d93cc6) |
| 10-30 00:45 | wARS | sold | 9.73 | +2.0 | [0x9bdc…3f83](https://celoscan.io/tx/0x9bdcfdca28baa6c1e6702e0b2920dac84c3554e2785d64f8b7608bd43bfc3f83) |
| 10-30 12:46 | wBRL | sold | 9.21 | +5.5 | [0x4e83…9e4c](https://celoscan.io/tx/0x4e836a2b599873bd9d3fe648284afc2833aedcaf3ada21384d6becb5a5229e4c) |
| 10-30 17:56 | wARS | bought | 10.00 | +5.9 | [0xae26…104c](https://celoscan.io/tx/0xae2604e69341b05bc0b5c8ee2e6e18e6417994c50ebf1ef46d1ea7d9adbf104c) |
| 10-30 18:03 | wARS | sold | 9.68 | −8.3 | [0xda08…00dc](https://celoscan.io/tx/0xda08ffa6b5352dba973e466f77857899f0d1c155460b950f7e7c4ad455df00dc) |
| 10-30 18:35 | wARS | sold | 0.82 | −0.9 | [0x988b…53d3](https://celoscan.io/tx/0x988bcc6b0846111326562164e3c50c159eda4cfbefbc69424f5f411be2bc53d3) |
| 10-30 19:27 | wARS | bought | 10.00 | −7.2 | [0x858d…d109](https://celoscan.io/tx/0x858d52bfaf3eec9db8cdb44538a6a89cc9439988b84a8718f3c4976c2159d109) |
| 10-30 19:28 | wARS | sold | 9.67 | +1.8 | [0x7489…ab10](https://celoscan.io/tx/0x7489c8f7a365889d823ef649609a3c367160ddc4ed475260101f56fd09e4ab10) |
| 11-01 13:46 | wARS | bought | 10.00 | +1.7 | [0xd583…ea74](https://celoscan.io/tx/0xd58338929aed967cae28db025909b0445c106b948bdec5046959e494de99ea74) |
| 11-01 13:51 | wARS | sold | 9.70 | −4.7 | [0x29a2…11cd](https://celoscan.io/tx/0x29a28f5b2c785a0a1e52e2179cde7fcbe049e8d43d039329aa4cd21e580b11cd) |
| 11-02 12:10 | wARS | bought | 5.00 | +4.0 | [0x1402…ab80](https://celoscan.io/tx/0x140235ea05be7f7fea9d4ce9a616223da3a16b3adc63e123bfb7e8424c57ab80) |
| 11-02 13:22 | wARS | sold | 5.58 | +9.8 | [0xde5f…1428](https://celoscan.io/tx/0xde5fa2dc96199428869cdd6312027f798d25e319b5def7dd58a7a2d6421e1428) |
| 11-02 14:09 | wARS | bought | 0.00 | +16.9 | [0x5d16…2fcc](https://celoscan.io/tx/0x5d1680efd6ec7851bffaa15170c94723ca18324e97c3316c101f37920dfa2fcc) |
| 11-02 14:47 | wARS | bought | 8.60 | +0.3 | [0x9747…8e9c](https://celoscan.io/tx/0x9747f07c622024c3af2ecc5b5518574cd446493660dfd123487b2193ead58e9c) |
| 11-02 14:54 | wARS | bought | 5.00 | −3.4 | [0xb56b…196d](https://celoscan.io/tx/0xb56bd5ee8da1f08d7caafdbe4d049da24c649c7367e927dc1aa34a53b14d196d) |
| 11-02 14:57 | wARS | sold | 9.69 | −1.1 | [0x6670…24fb](https://celoscan.io/tx/0x66706306ab3062a6071a4d67258368d95cd5b2836cbe84b2cb6ba712577a24fb) |
| 11-02 19:18 | wARS | bought | 0.00 | +16.2 | [0x198b…7495](https://celoscan.io/tx/0x198b812262c51f1b00f528ddc8d80083094f9a112a4b9311e63fdc2c6fe57495) |
| 11-02 19:54 | wARS | bought | 10.00 | +0.7 | [0xbcdc…f659](https://celoscan.io/tx/0xbcdcdcc7b61a6d594bcfcbb9d8f818dd83d230d35ed3dd98a3d47d33bab7f659) |
| 11-03 02:35 | wBRL | bought | 5.00 | +6.8 | [0x86e3…3d57](https://celoscan.io/tx/0x86e3c612d4b62d27ed4d43b5b1c01bab2c56a3caf38454233f3fb4740cc83d57) |
| 11-03 13:18 | wARS | sold | 9.68 | +3.2 | [0xbb3f…1419](https://celoscan.io/tx/0xbb3f47ab9f8a55a317818b3470af59e0c5cf946954580e08dd7ee30ec61b1419) |
| 11-03 13:37 | wARS | bought | 5.00 | −3.8 | [0xf4b3…e93a](https://celoscan.io/tx/0xf4b31383c4a2d78a6877aa30e555358938845593c05b5e1d8c913fc2fe1ee93a) |
| 11-03 22:13 | wARS | sold | 5.82 | +9.7 | [0x7865…0ae4](https://celoscan.io/tx/0x786579afee4e486f7e076ce1e13ea6babb4ad94da1ceff52449bcd1b63fe0ae4) |
| 11-04 06:35 | wBRL | sold | 1.20 | +4.1 | [0x1260…bc9e](https://celoscan.io/tx/0x1260c9217527f98583d3d4f343f273537e734dc83eb08dfc041425277e86bc9e) |
| 11-04 10:09 | wARS | bought | 0.87 | +4.0 | [0xe835…a15b](https://celoscan.io/tx/0xe835ac7e5178c9efdd3e42d880e3c5025d3b227577830d90c4c4c555d3caa15b) |
| 11-04 10:09 | wARS | bought | 1.50 | +2.1 | [0x4861…5aef](https://celoscan.io/tx/0x4861681bb1c18ea35d70ad78adc1bff259fd63a41d38b11be09926a0be205aef) |
| 11-04 11:10 | wBRL | sold | 5.05 | +4.3 | [0xa5f6…cdf2](https://celoscan.io/tx/0xa5f669d4a2307272a840d0f9ec95d61542f74bbc1318657c870fc2861b09cdf2) |
| 11-04 11:12 | wBRL | bought | 0.00 | +10.4 | [0xec70…5e5a](https://celoscan.io/tx/0xec700110bf5fc3109ed604a014a01d167565f4893074c034e816d685ec7f5e5a) |
| 11-04 12:36 | wARS | bought | 5.00 | +7.6 | [0x9c8e…d52a](https://celoscan.io/tx/0x9c8e44736e44e73d0c28a7bb298e67150a91fd0fa8d0e6bdc91dc20a18f1d52a) |
| 11-04 13:50 | wARS | sold | 7.32 | +4.6 | [0x3a57…723a](https://celoscan.io/tx/0x3a5721796dcc6579c962e1e4e3c51aa0f9d6e293556e3807258e70f51e4d723a) |
| 11-04 19:30 | wARS | bought | 10.00 | +4.0 | [0xe90a…813d](https://celoscan.io/tx/0xe90a1831e006d83d764bd71e859f39b6e954fc9ee7856a2e0143e2fb894b813d) |
| 11-04 19:46 | wARS | sold | 9.60 | −4.4 | [0x780b…ef5f](https://celoscan.io/tx/0x780ba89d65365dac20e8056a0f4406a0dc8096b587bb1b9784a690a3b0a4ef5f) |
| 11-04 21:14 | wARS | bought | 5.00 | +4.0 | [0xb60d…ae52](https://celoscan.io/tx/0xb60d89816715f7e937981fb35b1eb0c8f36bcd7d64b5073d314567db372eae52) |
| 11-04 21:54 | wARS | sold | 5.38 | −7.1 | [0x52e4…b029](https://celoscan.io/tx/0x52e4ec4086a1fbc5be209e796a04072a132e474f0f631f99ab49db3ec23db029) |
| 11-05 07:51 | wARS | bought | 10.00 | +5.7 | [0xfced…799c](https://celoscan.io/tx/0xfcedf7fe6e723b9aa00d1c445486b5d9bf8a353c2d27e4cc4687ad537d12799c) |
| 11-05 08:39 | wARS | sold | 9.60 | +5.9 | [0x0253…7977](https://celoscan.io/tx/0x025367c4eaee0eb8864b6a6eef27ab9e368af327ab7b33dc5810f72421997977) |
| 11-05 09:41 | wARS | bought | 5.00 | +8.3 | [0xf592…bbfa](https://celoscan.io/tx/0xf5927089f41bed5115a5412f7f0f330c4ac8ec45011b86fc346eb0cf815abbfa) |
| 11-05 09:46 | wARS | sold | 5.41 | −0.4 | [0xe8c1…db17](https://celoscan.io/tx/0xe8c1e1472cde88dc1644c5f76e9dcb7da046d098069c66bf70263da52923db17) |
| 11-05 09:54 | wARS | bought | 0.00 | +18.7 | [0xeb69…981c](https://celoscan.io/tx/0xeb69eda0d1ee81d8dc5593a411f0f25eee13fc54373731d0588bfbabeec2981c) |
| 11-05 09:54 | wARS | bought | 0.00 | +18.7 | [0x4c48…e8e8](https://celoscan.io/tx/0x4c4837889e83935d85d8bedcd0eef198866b6329c44608e8e02413f813bfe8e8) |
| 11-05 12:14 | wARS | bought | 0.00 | +8.3 | [0xd989…80f0](https://celoscan.io/tx/0xd9891a369e5c11d3d3849c29268cba5ef03f465a65f548e9fc7cb8c827fb80f0) |
| 11-05 13:39 | wARS | bought | 1.99 | −4.7 | [0x9d4f…a477](https://celoscan.io/tx/0x9d4f34b888acdaea7e33e2a5b232974b1bc8205e07611ad3229b92b2f8b9a477) |
| 11-05 13:41 | wARS | sold | 2.00 | +7.6 | [0x1a98…4dfd](https://celoscan.io/tx/0x1a9859413993744488640a52dea0ce2e54b4ed779262c6f107ba1ada029e4dfd) |
| 11-05 13:41 | USDC | bought | 4.76 | +2.5 | [0x6bdd…9434](https://celoscan.io/tx/0x6bdda72943cbb447fa5056505c56a775a5b97addb0d347d5969a4af8e7609434) |
| 11-05 15:35 | wARS | bought | 10.00 | +4.8 | [0x8a6f…81e2](https://celoscan.io/tx/0x8a6f649eb1c8c5f3aacb267f77596d2165e577ec4afbcce13d3ebf45c64e81e2) |
| 11-05 15:51 | wARS | sold | 9.61 | +2.0 | [0x4587…b56e](https://celoscan.io/tx/0x458715a68cc58c365f73c6e22f2f5a472c8133e29dd41a2c607f453e95a9b56e) |
| 11-05 15:59 | wARS | sold | 0.41 | +10.7 | [0x9184…7e34](https://celoscan.io/tx/0x9184a26378a290b45125972d1c28ba7c7107bf3564d646f7c9da6c5bbca97e34) |
| 11-05 18:34 | USA₮ | sold | 10.00 | +3.5 | [0x4c94…caf8](https://celoscan.io/tx/0x4c947b73eadb6c8a8b18ea5b4641e06735811ac61c8afb8545e66d18ab3fcaf8) |
| 11-05 18:39 | wARS | bought | 4.51 | +7.3 | [0x93bb…e65b](https://celoscan.io/tx/0x93bb6cbfdd3be7f38229712ee7fe7007ce917e18f2d465a19967ef58f3fce65b) |
| 11-05 19:15 | wARS | sold | 4.53 | +5.1 | [0xce69…10f5](https://celoscan.io/tx/0xce69a8c4cd1d9fbb502ea25fb080805fd69c2a0096a14bf4fc6136a758dd10f5) |
| 11-05 20:29 | wARS | bought | 0.00 | +22.8 | [0x68d0…d471](https://celoscan.io/tx/0x68d02e67b51c5e39536f3387604396fcb1b76f909e963ad7f34df88558ddd471) |
| 11-05 20:29 | wARS | bought | 0.00 | +15.1 | [0x8d22…83a0](https://celoscan.io/tx/0x8d22d36ed4fa4c78831a31f605d559361cab474ddca5be0c583f1c416e6783a0) |
| 11-05 22:53 | wARS | bought | 10.00 | −7.2 | [0x9a19…f53f](https://celoscan.io/tx/0x9a190c9f94cf64c67f73afa354ed2059616292aafa006678e0b8503c87c0f53f) |
| 11-05 23:00 | wARS | sold | 9.67 | +2.0 | [0xa6fd…2ced](https://celoscan.io/tx/0xa6fdc6fa6d78c3508488c4a6c4cc314cd5553b12807c0f005f1e4a76f6462ced) |
| 11-06 02:05 | wARS | sold | 0.32 | −10.3 | [0x3926…57eb](https://celoscan.io/tx/0x392644947d7404962d7d662297347c19e6e417fab1f9229bcf56c275fbf657eb) |
| 11-06 13:03 | wARS | bought | 10.00 | −3.4 | [0xaa3f…4480](https://celoscan.io/tx/0xaa3f7e2742b69c9119090e8281041c6d2fd4920ef1b558463924588349eb4480) |
| 11-06 13:08 | wARS | sold | 1.78 | −3.8 | [0x55e8…92b7](https://celoscan.io/tx/0x55e8a90f89cf393b58d5978d325ef1aee7239251c4b35a74566fa83cf1cf92b7) |
| 11-06 15:52 | USA₮ | bought | 10.00 | +1.0 | [0x3342…190c](https://celoscan.io/tx/0x3342f73daf9bffdde544293bd7ef321eeefbf0a7f5f3c34cc9378a1c9b59190c) |
| 11-06 22:52 | wBRL | sold | 4.94 | +10.3 | [0xcf00…1e73](https://celoscan.io/tx/0xcf000f65792882d6773e824576105ed4c55ac4b2bc3a44cdbf595f24f0a11e73) |
| 11-07 08:48 | wBRL | sold | 4.00 | +6.4 | [0xfc58…89a1](https://celoscan.io/tx/0xfc589a7f8847761d73573032a1028ad79686a44f26ea29234ccc4f113a7689a1) |
| 11-07 11:37 | wBRL | bought | 2.00 | +4.3 | [0x8933…14a1](https://celoscan.io/tx/0x8933657ba8b353e719b8dced7b9506ea54e149778d0b824c03e954599fc814a1) |
| 11-07 12:42 | wBRL | bought | 2.00 | +3.0 | [0x167c…5882](https://celoscan.io/tx/0x167cf8b849e5c7cf6787ba5831c2a03bd1896d0e64073146326d16a2da455882) |
| 11-07 19:16 | wBRL | bought | 13.62 | +5.6 | [0x4a58…e756](https://celoscan.io/tx/0x4a5827b57fae5e2b9c8ce678cf83635ed46731a6abdd7754ca84e0e96c77e756) |
| 11-08 01:51 | USA₮ | sold | 9.98 | +3.3 | [0x78b2…2769](https://celoscan.io/tx/0x78b2deaef43581dc5392c090df5ea85c135b78db0faf0ad9a897fdbc13162769) |

Edge is measured against the feed's fair price when the fill landed; a negative value means fair moved between the quote and the fill.

## P&L (2026-11-08)
| | US$ |
|---|---|
| Capital in (four 40 USDT deposits) | 160.00 |
| Value now (inventory at fair) | 158.18 |
| **Result** | **−1.82 (−1.14%)** |
| of which: spread earned on fills | **+0.10** (≈ +1.7 bps on US$ 594) |
| of which: inventory marked to fair, and the first inventory bought on Uniswap above fair | ≈ −1.92 |

The trading itself is slightly positive (+1.7 bps across 89 fills). In late October a few fills gave back part of the spread, which is the adverse selection the risk officer flagged. The loss comes from holding inventory: mostly the wBRL the desk bought around 5.03–5.08 BRL/USDT, marked near 5.45 on 2026-11-08 (the real fell about 7% against the dollar), plus the first inventory, which was bought on a thin Uniswap pool. Gas is paid by a separate ops wallet and isn't in these numbers.

Points 8 and 9 above came straight from this P&L: the loss was inventory held in a currency that was devaluing, bought while the price sources were already drifting apart.
