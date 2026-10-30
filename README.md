# Arbolito

**An AI money-changer for Latin America, on Celo.** An *arbolito* is the street money-changer of Buenos Aires. This one lives inside MiniPay and on Telegram:
- It changes and sends **dollars, Argentine pesos and Brazilian reais** (USDT, wARS, wBRL) at the best route it can find.
- It proves every conversion with a **receipt anchored onchain**.
- With the user's permission, it can **act on its own**: split a payday into pesos, or pay rent every month, within limits the user signs.

Next to it runs **Arbolito Desk**, a market maker that quotes six currency corridors on Textile FX.

Built for **Celo · Agents on Open Rails** (deadline Nov 9, 2026). Everything below runs on **Celo mainnet** with real money, and every transaction Arbolito sends carries our ERC-8021 attribution code **`celo_e054d92430a5`**.

| | Link |
|---|---|
| Website | [arbolito-livid.vercel.app](https://arbolito-livid.vercel.app) |
| Mini App | Built for MiniPay (Discover listing pending). Open `https://arbolito-livid.vercel.app/app` in MiniPay, or try the demo at [`/app?mock=1`](https://arbolito-livid.vercel.app/app?mock=1) |
| Telegram | [@arbolitoo_bot](https://t.me/arbolitoo_bot) (open to everyone) |
| Public metrics | [/metrics](https://arbolito-livid.vercel.app/metrics): conversions, receipts and volume, each linked to its transactions |
| Arbolito Desk | [/desk](https://arbolito-livid.vercel.app/desk): live quotes, fills, inventory, P&L and uptime; the strategy is in [docs/DESK-STRATEGY.md](docs/DESK-STRATEGY.md) |
| Agent identity | ERC-8004 **agentId 9976** ([registration](https://arbolito-livid.vercel.app/.well-known/agent-registration.json)) |

## The problem
Across Latin America, moving money usually means going through the dollar first, with fees at every step:
- **Argentina:** the official dollar and the dollar people actually trade at differ by several percent.
- **Brazil to Argentina:** sending reais to family means two currency changes and a bank in the middle.

Ripio's local stablecoins on Celo (wARS, wBRL) make that a token swap. But a person in MiniPay still has to know where the best price is, check they weren't overcharged, and remember to do it every month.

## What Arbolito does (Stable Agents: LatAm)
- **Change money in a chat or with a tap.**
  - Type or say *"pasá 100 dólares a pesos"* (or use the Change button).
  - Arbolito quotes the best route across **Textile RFQ firm quotes and Uniswap v3**, shows how it compares with the official rate, and you confirm in MiniPay.
  - The receipt says what you paid, what you got and what you saved.
- **Send to a contact.** In the same currency, or converted on the way: you pay dollars, Mamá receives pesos.
- **Receipts anyone can verify.**
  - Every conversion produces a ProofBundle (route, quotes, transactions).
  - Its hash is anchored on our [ArbolitoReceipts](https://celoscan.io/address/0x5C0b1208D81e0a44DEd74C7e01C54e8ee6b62d34) contract.
  - The public receipt page (`/r/<id>`) recomputes the hash in your browser and checks it against the chain.
- **Let Arbolito act for you** (opt-in):
  - **Setup:** the user gives Arbolito a bounded permission through **[ArbolitoGuard](https://celoscan.io/address/0x411E44dB70476F74C3560F5cCFdbc8c63f231d33)**, an ownerless contract that enforces per-operation and daily limits, a list of allowed contacts, and a minimum price taken from the pool's 10-minute average price (TWAP).
  - **Rules:** they create them in the chat, for example *"send US$ 50 to Mamá in pesos every month on the 1st"* or *"when my pay arrives, put 30% in pesos"*, and turn each on by **signing its text in MiniPay**.
  - **Running them:** Arbolito's operator carries the rules out within those limits and messages the user on Telegram after each run.
- **Built for MiniPay.**
  - It connects automatically, shows amounts in the user's currency, and gas is paid in USDT.
  - It speaks Spanish, Portuguese and English, and takes voice notes.
  - The Telegram bot does the same; money only moves after a MiniPay confirmation.

## vs Western Union (Build with buy)
- **The question every family sending money asks:** "is this better than Western Union?" Arbolito answers it on each dollar → peso/real quote and receipt.
- **How:** a few times a day, Arbolito rents a browser through [buy](https://usebuy.ai) (x402, paid in USDT from its buy payer [`0xD07b…3e58`](https://celoscan.io/address/0xD07b5BD9C86eFB042af3343a9e4dae646f1f3e58)) and reads Western Union's own currency converter.
- **Example (2026-10-20):** Western Union paid R$ 4.82 per dollar, and Arbolito about 5.06, so roughly **5% more reais**. For pesos the two rates were about the same, before Western Union's transfer fee.
- **Proof:** Western Union's rate is stored as a reference in each receipt, citing the buy payment that read it, and [/metrics](https://arbolito-livid.vercel.app/metrics#buy) lists every reading with its Celo transaction.

## Arbolito Desk (Open Corridors: Textile FX)
- **Corridors:** a Textile maker quoting **wARS, wBRL, wCOP, wMXN, USDC and USA₮ against USDT**.
- **Engine:** Textile's own filler (Stitch) signs the quotes. Arbolito supplies the price it quotes from:
  - a multi-source fair value
  - devaluation-aware peso spreads
  - an inventory skew that never crosses fair
  - a circuit breaker
  - hard inventory caps
  - a rebalancer that pays its gas in USDT
  - an LLM risk officer that can only pause
- **Full reasoning, results and how to verify:** [docs/DESK-STRATEGY.md](docs/DESK-STRATEGY.md).

## Onchain, verifiable
| What | Where |
|---|---|
| Attribution code on every Arbolito tx | `celo_e054d92430a5` (ERC-8021) |
| ArbolitoReceipts (receipt anchors) | [`0x5C0b1208D81e0a44DEd74C7e01C54e8ee6b62d34`](https://celoscan.io/address/0x5C0b1208D81e0a44DEd74C7e01C54e8ee6b62d34) |
| ArbolitoGuard v2 (bounded autonomy) | [`0x411E44dB70476F74C3560F5cCFdbc8c63f231d33`](https://celoscan.io/address/0x411E44dB70476F74C3560F5cCFdbc8c63f231d33) |
| ERC-8004 identity | agentId **9976** on the Identity Registry `0x8004A169…a432` ([tx](https://celoscan.io/tx/0xbb465125ec0aa57324ab3ee39887755504222813a8341c45486abf9a95d5ce89)) |
| Desk maker wallet | [`0xBCB8B7dcEB8B39457Ef6D5dC95520A562b13EdbE`](https://celoscan.io/address/0xBCB8B7dcEB8B39457Ef6D5dC95520A562b13EdbE) |
| Rules operator | [`0xeA7135ec38D6C289D781D22059eCf6007c6f36b4`](https://celoscan.io/address/0xeA7135ec38D6C289D781D22059eCf6007c6f36b4) |
| buy payer (x402) | [`0xD07b5BD9C86eFB042af3343a9e4dae646f1f3e58`](https://celoscan.io/address/0xD07b5BD9C86eFB042af3343a9e4dae646f1f3e58) |

Every address and endpoint we rely on is checked against the chain: [docs/04-reference.md](docs/04-reference.md), and `pnpm verify:addresses`.

## How it's built
```
MiniPay Mini App ─┐                  ┌─ Uniswap v3 (quotes, swaps)
Telegram bot ─────┼─► router ────────┼─ Textile RFQ (firm quotes, partner key)
Chat (DeepSeek) ──┘   best route     └─ dolarapi, Textile prices (references)
                        │
                        ├─► ProofBundle ──► ArbolitoReceipts (anchor) ──► /r/<id> (verify in browser)
                        └─► ArbolitoGuard ◄── rules runner (operator, every 60 s)

Arbolito Desk: price feed ─► Stitch (Textile filler) ◄─► Textile RFQ; ledger → /desk
```
- **Monorepo:** pnpm, TypeScript (strict), viem, Next.js 16 on Vercel, Postgres (Neon), Foundry contracts, Vitest.
- **Services:** the Telegram bot (which also runs the rules) and the desk run on Railway.
- **Money safety** (rules in [CLAUDE.md](CLAUDE.md)):
  - Every transaction Arbolito sends is **simulated first**, **tagged**, and **capped** in code (≤ US$ 5 per action, ≤ US$ 25 a day while building).
  - Nothing that may have moved money is retried blindly.
  - Every mainnet send is rehearsed first on an **anvil fork of Celo mainnet**.
- **Tests:** about 420 unit tests, plus database tests and fork tests against real mainnet state (the guard, the rules runner, routes).

## Repo map
| Path | What |
|---|---|
| `apps/web` | Website, MiniPay Mini App (`/app`), receipts (`/r`), `/metrics`, `/desk`, and the Mini App's API |
| `apps/agent` | Telegram bot and the rules runner |
| `apps/desk` | Arbolito Desk: price feed, Stitch supervisor, risk officer, rebalancer, ledger |
| `packages/router` | Uniswap v3 and Textile RFQ adapters, the route planner, the executor |
| `packages/proof` | ProofBundle schema, canonical hashing, anchoring, verification |
| `packages/rules` | Standing rules: types, signed text, schedule, the runner |
| `packages/x402`, `packages/competitors` | x402 v1 client (pays buy), and reading Western Union in a rented browser |
| `packages/chain` | Clients, the guarded sender (caps, attribution, simulation), guard encoders |
| `packages/llm`, `packages/db`, `packages/config` | Chat agent and tools, Postgres schema, verified config |
| `contracts/` | ArbolitoReceipts, ArbolitoGuard (Foundry) |

## Run it locally
Needs Node 22+, pnpm and [Foundry](https://getfoundry.sh). forge-std is vendored, so a plain `git clone` is enough (no submodules).

```bash
pnpm install
pnpm test                 # Foundry tests + unit tests; offline, no .env needed
cp .env.example .env      # fill in what you need; every variable is documented there
pnpm quote wBRL wARS 200  # live quote from mainnet (read-only)
pnpm --filter @arbolito/web dev   # then open http://localhost:3000/app?mock=1
```

The other test sets need outside services: `pnpm test:db` needs `DATABASE_URL` (Postgres), and `pnpm test:fork` needs `anvil` and a Celo RPC (it forks mainnet locally; nothing is sent). `pnpm test:all` runs everything.

## More docs
| File | What's in it |
|---|---|
| [docs/SCOPE.md](docs/SCOPE.md) | What's done and what's left, mapped to the judging criteria |
| [docs/STATUS.md](docs/STATUS.md) | The build log, newest first |
| [docs/DESK-STRATEGY.md](docs/DESK-STRATEGY.md) | The desk's strategy, results and how to verify them |
| [docs/04-reference.md](docs/04-reference.md) | Verified addresses, pools, endpoints and gotchas |
| [docs/03-architecture.md](docs/03-architecture.md), [docs/02-product-spec.md](docs/02-product-spec.md) | Architecture and product spec |
| [PLAN.md](PLAN.md), [CLAUDE.md](CLAUDE.md) | The original plan, and the standing rules for coding agents in this repo |
