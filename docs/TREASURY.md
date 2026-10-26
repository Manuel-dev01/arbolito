# Treasury: where Arbolito's money is

Every dollar the founder puts in, and every move between Arbolito's wallets, with its transaction.
`pnpm ops:send` appends a row on each live send. All amounts are onchain and checkable on Celoscan.

## Wallets
| Wallet | Address | Holds it for |
|---|---|---|
| ops | `0x7e0316b2533F6dF2E651295A9B11481BB8346c3c` | Receives founder funding; pays gas top-ups, transfers and welcome credits |
| desk | `0xBCB8B7dcEB8B39457Ef6D5dC95520A562b13EdbE` | Arbolito Desk inventory (Textile FX maker) |
| buy payer | `0xD07b5BD9C86eFB042af3343a9e4dae646f1f3e58` | x402 paid calls through buy (Western Union rates) |

## Funding in
| Date | From | To | Amount | Note |
|---|---|---|---|---|
| 2026-10-15 → 10-20 | founder `0x7769…a734` | desk | 120 USDT | three deposits of 40 (blocks 80170952, 80313359, 80404036) |
| 2026-10-26 | founder | ops | 200 USDT | launch budget: desk inventory, buy calls, welcome credits (ops held 4.40 → 204.40) |

## Plan for the 2026-10-26 budget (200 USDT)
| Use | Amount | Track |
|---|---|---|
| Desk inventory, healthy corridors (not wBRL until its price settles) | 80 | Textile FX |
| buy payer: Western Union rate reads | 30 | buy |
| Welcome credits, US$ 5 each to approved real users | 75 | LatAm |
| Gas and buffer | 15 | |

**2026-10-26 note:** the second 40 USDT for the desk is on hold. The desk has had no fills since
2026-10-20 (8 fills, US$ 110 volume in total), so it is short of RFQ flow, not capital; more inventory
only helps once requests come in larger than its caps.

## Moves (appended by `pnpm ops:send`)
| Time (UTC) | Move | To | Amount | Tx |
|---|---|---|---|---|
| 2026-10-26 15:48 | ops → desk wallet | 0xBCB8B7dcEB8B39457Ef6D5dC95520A562b13EdbE | 40 USDT | [tx](https://celoscan.io/tx/0x5588598d4d4c9307f4a7d4b0e9319f12bac06366ecfb593198a4f126eebc2c7c) |
| 2026-10-26 15:48 | ops → buy payer | 0xD07b5BD9C86eFB042af3343a9e4dae646f1f3e58 | 30 USDT | [tx](https://celoscan.io/tx/0x96b067e57b8239954f876a4b3be00d7a45e2d198a9a338a29aa1425dbaf52fb3) |
