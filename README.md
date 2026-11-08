# Arbolito

**An AI money-changer for Latin America, on Celo: an agent that charges, pays and settles in local stablecoins.** An *arbolito* is the street money-changer of Buenos Aires. This one lives inside MiniPay and on Telegram:
- It changes and sends **dollars, Argentine pesos, Brazilian reais, Colombian and Mexican pesos** (USDT, wARS, wBRL, wCOP, wMXN) at the best route it can find.
- It proves every conversion with a **receipt anchored onchain**.
- With the user's permission, it **acts on its own**: it splits a payday into pesos, pays rent every month, and guards peso savings against devaluation, all within limits the user signs.
- **Other agents hire it** over MCP, A2A and x402 and pay it in wARS, wBRL, wCOP, wMXN or dollars. It **pays other agents** for what it uses and rates them onchain (ERC-8004).

Next to it runs **Arbolito Desk**, a market maker that quotes six currency corridors on Textile FX.

Built for **Celo · Agents on Open Rails** (deadline Nov 9, 2026). Everything below runs on **Celo mainnet** with real money, and every transaction Arbolito sends carries our ERC-8021 attribution code **`celo_e054d92430a5`**.

| | Link |
|---|---|
| Demo video | [4-minute walkthrough on YouTube](https://youtu.be/lB6YraoRJ7g) |
| Website | [arbolito-livid.vercel.app](https://arbolito-livid.vercel.app) |
| Mini App | Built for MiniPay (Discover listing pending). Open `https://arbolito-livid.vercel.app/app` in MiniPay, or try the demo at [`/app?mock=1`](https://arbolito-livid.vercel.app/app?mock=1) |
| Telegram | [@arbolitoo_bot](https://t.me/arbolitoo_bot) (open to everyone) |
| The agent | [/agent](https://arbolito-livid.vercel.app/agent): what it charges, pays and settles, each row a Celo transaction |
| Public metrics | [/metrics](https://arbolito-livid.vercel.app/metrics): conversions, receipts and volume, each linked to its transactions |
| Arbolito Desk | [/desk](https://arbolito-livid.vercel.app/desk): live quotes, fills, inventory, P&L and uptime |
| Agent identity | ERC-8004 **agentId 9976** ([registration](https://arbolito-livid.vercel.app/.well-known/agent-registration.json), [8004scan](https://8004scan.io/agents/celo/9976)) |
| For agents | MCP `https://arbolito-livid.vercel.app/api/mcp` · A2A [agent card](https://arbolito-livid.vercel.app/.well-known/agent-card.json) · x402 `GET /api/x402/quote`, `GET /api/x402/rates` |

## Contents
- [Try it in 5 minutes](#try-it-in-5-minutes)
- [Where each track is answered](#where-each-track-is-answered)
- [The problem](#the-problem)
- [What Arbolito does (Stable Agents: LatAm)](#what-arbolito-does-stable-agents-latam)
- [Charges, pays and settles in local stablecoins](#charges-pays-and-settles-in-local-stablecoins)
- [Hire Arbolito (for agents)](#hire-arbolito-for-agents)
- [vs Western Union (Build with buy)](#vs-western-union-build-with-buy)
- [Arbolito Desk (Open Corridors: Textile FX)](#arbolito-desk-open-corridors-textile-fx)
- [Onchain, verifiable](#onchain-verifiable)
- [How it's built](#how-its-built)
- [Repo map](#repo-map)
- [Run it locally](#run-it-locally)
- [More docs](#more-docs)

## Try it in 5 minutes
1. **The app, without a wallet.** Open [`/app?mock=1`](https://arbolito-livid.vercel.app/app?mock=1) on a phone-sized window.
   - Change US$ 100 to pesos: you see the best route, the official rate and Western Union side by side.
   - Confirm it, then open the receipt.
   - Demo mode moves no money.
2. **The real thing.** In MiniPay, open `https://arbolito-livid.vercel.app/app` (it connects by itself), or message [@arbolitoo_bot](https://t.me/arbolitoo_bot) *"cuántos pesos me dan por 10 dólares"*.
3. **A real receipt.** Open any receipt from [/metrics](https://arbolito-livid.vercel.app/metrics#receipts). The page recomputes its hash in your browser and checks it against Celo: anchored, executed, and delivered exactly what it says. Expect a green "Verified".
4. **The attribution tag.** On that receipt, open the execution transaction on Celoscan → *Input Data*. The calldata ends with the ERC-8021 suffix for `celo_e054d92430a5`.
5. **The agent.** Open [/agent](https://arbolito-livid.vercel.app/agent): x402 sales, payments to buy and other agents (with their ERC-8004 ratings), and automatic rule runs, each with its transaction.
6. **Hire it from your own agent.**
   - In Claude Code: `claude mcp add --transport http arbolito https://arbolito-livid.vercel.app/api/mcp`, then ask for `get_rates_summary` (free) or `get_quote` (it returns the x402 payment terms).
   - Or with curl: `curl -i https://arbolito-livid.vercel.app/api/x402/rates` returns a `402` whose `PAYMENT-REQUIRED` header lists the price in wARS, wBRL, wCOP, wMXN, USDT, USDC and USA₮.
7. **The desk.** [/desk](https://arbolito-livid.vercel.app/desk) shows quotes, fills from outside takers, inventory and P&L. [8004scan](https://8004scan.io/agents/celo/9976) shows the identity.

## Where each track is answered
| Track | Criterion | Evidence |
|---|---|---|
| **Stable Agents: LatAm** | Works on mainnet with real wFIAT | wARS/wBRL/wCOP/wMXN conversions with anchored receipts ([/metrics](https://arbolito-livid.vercel.app/metrics)); every tx tagged |
| | Real use of wFIAT and the Celo stack | x402 through Celo's facilitator, priced in wFIAT ([Charges](#charges-pays-and-settles-in-local-stablecoins)); ERC-8004 identity, reputation from users and toward other agents; gas paid in USDT (MiniPay and fee adapters) |
| | Agent autonomy and usefulness | Rules through ArbolitoGuard: monthly sends, payday splits, the [peso guardian](#what-arbolito-does-stable-agents-latam); decision logic in [ARCHITECTURE § 4.3](docs/ARCHITECTURE.md#43-automatic-rules-and-the-peso-guardian) |
| | UX a real person can use | MiniPay Mini App and Telegram in es/pt/en, voice notes, amounts in the user's currency; [try it](#try-it-in-5-minutes) |
| | Impact for LatAm | [The problem](#the-problem); savings vs official and Western Union on every receipt |
| **Open Corridors: Textile FX** | Strategy, P&L, originality | [docs/DESK-STRATEGY.md](docs/DESK-STRATEGY.md), [docs/TEXTILE-WRITEUP.md](docs/TEXTILE-WRITEUP.md), [/desk](https://arbolito-livid.vercel.app/desk); maker wallet in [Onchain](#onchain-verifiable) |
| **Build with buy** | Paid calls from the tagged wallet, for a named need | [vs Western Union](#vs-western-union-build-with-buy); every reading and its payment on [/metrics](https://arbolito-livid.vercel.app/metrics#buy) and [/agent](https://arbolito-livid.vercel.app/agent#pays) |

The official criteria we built against: [docs/08-judging-criteria.md](docs/08-judging-criteria.md). What's done and what's left: [docs/SCOPE.md](docs/SCOPE.md).

## The problem
Across Latin America, moving money usually means going through the dollar first, with fees at every step:
- **Argentina:** the official dollar and the dollar people actually trade at differ by several percent, and the peso's value moves week to week.
- **Brazil to Argentina:** sending reais to family means two currency changes and a bank in the middle.

Ripio's local stablecoins on Celo (wARS, wBRL, wCOP, wMXN) make that a token swap. But a person in MiniPay still has to:
- know where the best price is
- check they weren't overcharged
- remember to do it every month
- decide how much of their savings to keep in dollars

## What Arbolito does (Stable Agents: LatAm)
- **Change money in a chat or with a tap.**
  - Type or say *"pasá 100 dólares a pesos"* (or use the Change button).
  - Arbolito quotes the best route across **Textile RFQ firm quotes and Uniswap v3**, shows how it compares with the official rate and Western Union, and you confirm in MiniPay.
  - The receipt says what you paid, what you got and what you saved.
- **Send to a contact.** In the same currency, or converted on the way: you pay dollars, Mamá receives pesos.
- **Receipts anyone can verify.**
  - Every conversion produces a ProofBundle (route, quotes, transactions).
  - Its hash is anchored on our [ArbolitoReceipts](https://celoscan.io/address/0x5C0b1208D81e0a44DEd74C7e01C54e8ee6b62d34) contract.
  - The public receipt page (`/r/<id>`) recomputes the hash in your browser and checks it against the chain.
  - From a verified receipt, the user can **rate Arbolito onchain** (ERC-8004 reputation), with that receipt as the evidence.
- **Let Arbolito act for you** (opt-in):
  - **Setup:** the user gives Arbolito a bounded permission through **[ArbolitoGuard](https://celoscan.io/address/0x411E44dB70476F74C3560F5cCFdbc8c63f231d33)**. It's an ownerless contract that enforces per-operation and daily limits, a list of allowed contacts, and a minimum price taken from the pool's 10-minute average price (TWAP).
  - **Rules:** the user creates them in the chat and turns each on by **signing its text in MiniPay**:
    - *"send US$ 50 to Mamá in pesos every month on the 1st"*
    - *"when my pay arrives, put 30% in pesos"*
    - **the peso guardian:** *"keep half my savings in dollars, more if the peso falls"*. The agent keeps the chosen share of the user's pesos (or reais) and dollars in dollars, tilted by the currency's **measured one-week trend** from Arbolito Desk: about +2 points per 0.3% a month of devaluation, up to 20 points either way. It rebalances both ways when the share drifts past a band, at most once a day each way, and stands down when price sources disagree.
  - **Running them:** Arbolito's operator carries the rules out within those limits and tells the user on Telegram what it did and why.
- **Built for MiniPay.**
  - It connects automatically, shows amounts in the user's currency, and gas is paid in USDT.
  - It speaks Spanish, Portuguese and English, and takes voice notes.
  - The Telegram bot does the same; money only moves after a MiniPay confirmation.

## Charges, pays and settles in local stablecoins
| | What | How it's paid | Where to see it |
|---|---|---|---|
| **Charges** | Other agents buy Arbolito's best-route quotes (US$ 0.01) and its LatAm FX reference bundle (US$ 0.005) | x402 v2 through **Celo's facilitator**, payable in **wARS, wBRL, wCOP, wMXN** (Permit2, gasless approval) or USDT, USDC, USA₮. `payTo` is the agent wallet [`0x7e03…6c3c`](https://celoscan.io/address/0x7e0316b2533F6dF2E651295A9B11481BB8346c3c) | [/agent#charges](https://arbolito-livid.vercel.app/agent#charges) |
| **Pays** | buy's rented browser to read Western Union. Outside Celo agents it uses: first, RemitRoute's Mento FX route (agent #9308), rated on ERC-8004 after each call | x402 from the same agent wallet; capped, quoted before paying, never retried | [/agent#pays](https://arbolito-livid.vercel.app/agent#pays) |
| **Settles** | Users' conversions and sends, and the automatic runs it makes for them through ArbolitoGuard (monthly sends, payday splits, the peso guardian) | Uniswap v3 and Textile, signed by the user or by the guard within the user's limits | [/agent#settles](https://arbolito-livid.vercel.app/agent#settles), [/metrics](https://arbolito-livid.vercel.app/metrics) |

## Hire Arbolito (for agents)
- **MCP** (streamable HTTP, protocol 2025-06-18) at `https://arbolito-livid.vercel.app/api/mcp`:
  - Free tools: `get_rates_summary`, `desk_state`, `verify_receipt`.
  - Paid tools: `get_quote` and `get_rates` speak x402 over MCP. Call without `payment` to get the requirements; call again with a v2 `PAYMENT-SIGNATURE` value to pay and get the result.
- **A2A** (0.3.0) at `/api/a2a` (`message/send`), card at [`/.well-known/agent-card.json`](https://arbolito-livid.vercel.app/.well-known/agent-card.json):
  - Skills: `rates_summary`, `quote`, `rates`, `verify_receipt`, `desk_state`.
  - `chat` (free text) needs the caller's wallet in `metadata.account`.
- **x402 v2** directly:
  ```bash
  curl -i "https://arbolito-livid.vercel.app/api/x402/quote?from=USDT&to=wARS&amount=100"
  # 402 Payment Required; PAYMENT-REQUIRED lists 7 tokens on eip155:42220, payTo 0x7e03…6c3c,
  # extensions: builder-code (celo_e054d92430a5), eip2612GasSponsoring
  ```
  Pay with any x402 v2 client (exact scheme, Celo mainnet). Bad parameters are refused with a 400 before any payment is asked; a failed handler cancels the payment. `pnpm x402:check <url> <token>` signs a payment with a throwaway key and asks the facilitator to verify it, without settling.
- **OASF** record at [`/.well-known/oasf.json`](https://arbolito-livid.vercel.app/.well-known/oasf.json). All of the above are listed in the [ERC-8004 registration](https://arbolito-livid.vercel.app/.well-known/agent-registration.json).

## vs Western Union (Build with buy)
- **The question every family sending money asks:** "is this better than Western Union?" Arbolito answers it on each dollar → peso/real quote and receipt.
- **How:** every 6 hours, Arbolito rents a browser through [buy](https://usebuy.ai) and reads Western Union's own currency converter. It pays over x402, in USDT, from the agent wallet [`0x7e03…6c3c`](https://celoscan.io/address/0x7e0316b2533F6dF2E651295A9B11481BB8346c3c) ([`0xD07b…3e58`](https://celoscan.io/address/0xD07b5BD9C86eFB042af3343a9e4dae646f1f3e58) before 2026-10-28).
- **Example (2026-11-02):** a US$ 1 → wBRL conversion delivered R$ 5.45, **4.40% more reais** than Western Union's rate before its fee.
- **Proof:** Western Union's rate is stored as a reference in each receipt, citing the buy payment that read it. [/metrics](https://arbolito-livid.vercel.app/metrics#buy) lists every reading with its Celo transaction.

## Arbolito Desk (Open Corridors: Textile FX)
- **Corridors:** a Textile maker quoting **wARS, wBRL, wCOP, wMXN, USDC and USA₮ against USDT**.
- **Engine:** Textile's own filler (Stitch) signs the quotes. Arbolito supplies the price it quotes from:
  - a multi-source fair value
  - devaluation-aware, carry-adjusted inventory targets
  - an inventory skew that never crosses fair
  - buy caps that shrink as sources disagree, and a circuit breaker
  - hard inventory caps
  - a rebalancer that pays its gas in USDT
  - an LLM risk officer that can only pause
- **The same measured carry drives the peso guardian** for users: the desk's treasury logic, applied to a family's savings.
- **Full reasoning, results and how to verify:** [docs/DESK-STRATEGY.md](docs/DESK-STRATEGY.md) and [docs/TEXTILE-WRITEUP.md](docs/TEXTILE-WRITEUP.md).

## Onchain, verifiable
| What | Where |
|---|---|
| Attribution code on every Arbolito tx | `celo_e054d92430a5` (ERC-8021) |
| ArbolitoReceipts (receipt anchors) | [`0x5C0b1208D81e0a44DEd74C7e01C54e8ee6b62d34`](https://celoscan.io/address/0x5C0b1208D81e0a44DEd74C7e01C54e8ee6b62d34) |
| ArbolitoGuard v2 (bounded autonomy) | [`0x411E44dB70476F74C3560F5cCFdbc8c63f231d33`](https://celoscan.io/address/0x411E44dB70476F74C3560F5cCFdbc8c63f231d33) |
| ERC-8004 identity | agentId **9976** on the Identity Registry `0x8004A169…a432` ([tx](https://celoscan.io/tx/0xbb465125ec0aa57324ab3ee39887755504222813a8341c45486abf9a95d5ce89)) |
| ERC-8004 reputation | Reputation Registry v2.0.0 [`0x8004BAa1…9b63`](https://celoscan.io/address/0x8004BAa17C55a88189AE136b182e5fdA19dE9b63): users rate Arbolito; Arbolito rates the agents it pays |
| Agent wallet: ERC-8004 owner, x402 `payTo`, buy and agent payer | [`0x7e0316b2533F6dF2E651295A9B11481BB8346c3c`](https://celoscan.io/address/0x7e0316b2533F6dF2E651295A9B11481BB8346c3c) |
| Desk maker wallet | [`0xBCB8B7dcEB8B39457Ef6D5dC95520A562b13EdbE`](https://celoscan.io/address/0xBCB8B7dcEB8B39457Ef6D5dC95520A562b13EdbE) |
| Rules operator | [`0xeA7135ec38D6C289D781D22059eCf6007c6f36b4`](https://celoscan.io/address/0xeA7135ec38D6C289D781D22059eCf6007c6f36b4) |
| buy payer before 2026-10-28 | [`0xD07b5BD9C86eFB042af3343a9e4dae646f1f3e58`](https://celoscan.io/address/0xD07b5BD9C86eFB042af3343a9e4dae646f1f3e58) |

Every address and endpoint we rely on is checked against the chain: [docs/04-reference.md](docs/04-reference.md), and `pnpm verify:addresses`.

## How it's built
```
MiniPay Mini App ─┐                  ┌─ Uniswap v3 (quotes, swaps)
Telegram bot ─────┼─► router ────────┼─ Textile RFQ (firm quotes, partner key)
Chat (DeepSeek) ──┘   best route     └─ dolarapi, ER-API, ECB, Textile, Western Union via buy (references)
                        │
                        ├─► ProofBundle ──► ArbolitoReceipts (anchor) ──► /r/<id> (verify in browser)
                        └─► ArbolitoGuard ◄── rules runner: sends, splits, peso guardian (every 60 s)

Other agents ─► MCP / A2A / x402 (/api/x402/*) ─► Celo facilitator ─► agent wallet (payTo)
Agent wallet ─► buy (Western Union) and outside agents over x402 ─► ERC-8004 rating
Arbolito Desk: price feed ─► Stitch (Textile filler) ◄─► Textile RFQ; ledger → /desk; carry → peso guardian
```
- **Monorepo:** pnpm, TypeScript (strict), viem, Next.js 16 on Vercel, Postgres (Neon), Foundry contracts, Vitest.
- **Services:**
  - The web app (Mini App, its API, public pages, x402, MCP, A2A) runs on Vercel.
  - The Telegram bot runs on Railway. It also runs the rules, the Western Union reads and the agent purchases.
  - The desk feed runs on Railway too.
- **Money safety:**
  - The user's own MiniPay wallet signs every conversion and send. The chat agent has no tool that moves money.
  - Automatic runs go only through ArbolitoGuard, inside the limits the user set onchain.
  - Every transaction Arbolito sends is **simulated first**, **tagged**, and **capped** in code.
  - Nothing that may have moved money is retried blindly. Every paid call is quoted first, for free.
  - Every new money path is rehearsed on an **anvil fork of Celo mainnet** first. That covers the guard, the rules runner and the peso guardian, run against the deployed contract.
- **Tests:** about 500 unit tests and the Foundry suite (`pnpm test`, offline), plus database tests and fork tests against real mainnet state.
- **The full design:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). It covers components, wallets and keys, every money flow as a sequence diagram, the ProofBundle, the safety model, the data model and testing.

## Repo map
| Path | What |
|---|---|
| `apps/web` | Website, MiniPay Mini App (`/app`), receipts (`/r`), `/agent`, `/metrics`, `/desk`, the Mini App's API, the x402 API, MCP and A2A |
| `apps/agent` | Telegram bot, the rules runner, the Western Union runner, agent purchases |
| `apps/desk` | Arbolito Desk: price feed, Stitch supervisor, risk officer, rebalancer, ledger |
| `packages/router` | Uniswap v3 and Textile RFQ adapters, the route planner, the executor |
| `packages/proof` | ProofBundle schema, canonical hashing, anchoring, verification |
| `packages/rules` | Standing rules (send, split, guardian): types, signed text, schedule, decisions, the runner |
| `packages/x402` | x402 v1 client (pays buy), v2 client (pays other agents), the seller (Arbolito's paid API) |
| `packages/competitors` | Reading Western Union in a browser rented through buy |
| `packages/chain` | Clients, the guarded sender (caps, attribution, simulation), guard encoders, ERC-8004 reputation |
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

Other test sets need outside services:
- `pnpm test:db` needs `DATABASE_URL` (Postgres).
- `pnpm test:fork` needs `anvil` and a Celo RPC. It forks mainnet locally, and nothing is sent.
- `pnpm test:all` runs everything.

## More docs
| File | What's in it |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How it's built: components, wallets, every money flow, safety, data, tests |
| [docs/SCOPE.md](docs/SCOPE.md) | What's done and what's left, mapped to the judging criteria |
| [docs/STATUS.md](docs/STATUS.md) | The build log, newest first |
| [docs/DESK-STRATEGY.md](docs/DESK-STRATEGY.md) | The desk's strategy, results and how to verify them |
| [docs/TEXTILE-WRITEUP.md](docs/TEXTILE-WRITEUP.md) | The desk write-up for Textile |
| [docs/04-reference.md](docs/04-reference.md) | Verified addresses, pools, endpoints and gotchas |
| [docs/08-judging-criteria.md](docs/08-judging-criteria.md) | The official judging criteria we built against |
