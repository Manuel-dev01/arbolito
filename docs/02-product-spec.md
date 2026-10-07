# 02: Product spec

## Positioning
**Arbolito is the money-changer that lives in your chat.** Tell it, by text or voice in Spanish, Portuguese or English, to convert, send or protect money across pesos, reais and dollars. It finds the best route across open onchain markets, executes it on Celo, and hands you a receipt that proves the rate. Behind the scenes it runs its own FX desk, keeps its dollars in USA₮, and pays for its own tools.

## Personas
- **Lucía, freelancer in Buenos Aires.** Paid in USD stablecoins by foreign clients. Wants pesos for rent and groceries at the best rate (the crypto dollar runs ~4% above the official rate), and dollars kept as savings. Cashes out through Ripio.
- **Agência Sol, small agency in São Paulo.** Pays Argentine contractors and wants to send reais and have them land as pesos without SWIFT or a 3-day wait.
- **Developer agent.** Another hackathon team's agent. It needs wARS/wBRL↔USD conversion, or wants to pay x402 APIs in local currency. Talks to Arbolito's FX API or MCP server.
- **Arbolito Desk (internal).** Quotes Textile corridors, earns spread, and pays its own compute and data.

## Surfaces
| Surface | Purpose | Priority |
|---|---|---|
| Telegram bot | Primary UX: chat and voice; convert, send, balances, rules, receipts | P0 |
| Telegram Mini App (Next.js) | Wallet login, approvals above caps, onboarding, receipt viewer | P0 |
| Public receipt pages `/r/:id` | Shareable proof of each route | P0 |
| Public metrics page `/metrics` | Live adoption, volume, desk and USA₮ numbers for judges | P0 |
| x402 FX API + `arbolito-mcp` | Agent-to-agent: quote, convert, send | P1 |
| Desk dashboard `/desk` | Quotes, fills, inventory, P&L, self-funded costs | P1 |
| Group "vaquinha" mode | Split costs in group chats, settle across currencies | P2 |
| WhatsApp channel | Same agent over WhatsApp | P2 |

## Features and acceptance criteria

### P0: must be live by Day 5
1. **Onboarding.**
   - `/start` detects the language (es/pt/en) and opens the Mini App to create or log in to a wallet.
   - Sets the session-key caps (default: $25 per action, $100/day).
   - Shows deposit paths:
     - Ripio app: withdraw wARS/wBRL to the Celo address.
     - Send USDT/USDC/USA₮ on Celo.
   - *AC:* a new user goes from `/start` to a funded wallet without leaving Telegram, except for Ripio.
2. **Balances.** "¿Cuánto tengo?" / "Quanto eu tenho?" returns token balances and a USD total.
   - *AC:* correct to the latest block; under 2s.
3. **Quote and convert.** "Pasá 100 USDT a pesos" / "Converte 500 reais em dólar".
   - Shows a **route card**: chosen route, alternatives, rate vs official/MEP/CCL references, fee, and expiry countdown.
   - On tap-confirm, it executes.
   - *AC:* quote in under 4s; the executed rate equals the quoted rate, or the user is shown why not; a receipt link follows.
4. **Send (incl. cross-border).** "Mandale 50.000 pesos a Lucía" / "Manda 200 reais pra Lucía em Buenos Aires".
   - Resolves the contact, converts if needed (BRL→USDT→ARS), and delivers in the recipient's currency.
   - Notifies the recipient (if they're an Arbolito user) in their own language.
   - *AC:* a BRL→ARS cross-border send completes on mainnet with one receipt covering both legs.
5. **Route receipts.** Every execution produces a ProofBundle:
   - all quotes considered (venue, amounts, maker signature where available, block number)
   - reference rates (+ source)
   - the chosen route and the executed tx
   - a savings line

   Its hash is emitted onchain (`ArbolitoReceipts`). A public page renders it.
   - *AC:* anyone can recompute the hash from the page's JSON and find it in the onchain event.
6. **Metrics page.**
   - unique wallets and transactions
   - wFIAT volume by token
   - corridor volume
   - receipts
   - median savings vs official
   - Desk quoted volume, fills and P&L
   - USA₮ settlements (count/$)
   - buy calls (count/$)
   - API sales
   - *AC:* auto-refreshes; every number links to its onchain source or receipt.
7. **Identity.** ERC-8004 registration (agent card with endpoints), Self Agent ID, and the attribution suffix on every tx.

### P1: Days 5–8
8. **Competitor capture (buy browser).**
   - For a send, rents a 1–2 minute agent browser to load a competitor quote page (Western Union / Remitly / bank) for the same amount and corridor.
   - Extracts the rate, stores a screenshot hash in the ProofBundle, and shows "you saved X".
   - *AC:* shown in under 30s, asynchronously. A failure degrades gracefully to reference rates only.
9. **Standing rules.**
   - payday split ("cuando entren USDT, 30% a pesos, resto a USA₮")
   - scheduled sends
   - price triggers (via Textile gasless limit orders or the agent's watcher)
   - *AC:* rules run autonomously within caps and report each run with a receipt.
10. **x402 FX API.**
    - Endpoints: `GET /v1/quote` (cheap), `POST /v1/convert`, `POST /v1/send`.
    - Payable in USA₮/USDC/USDT/wARS/wBRL/wCOP. Bazaar metadata. Listed in the ERC-8004 agent card. Buy listing requested.
    - `arbolito-mcp` exposes the same tools to Claude Code / Cursor.
    - *AC:* another team's agent completes a paid convert end to end.
11. **Arbolito Desk v1.**
    - Stitch quotes wARS/wBRL/cNGN from Arbolito's `/fairvalue` feed:
      - Textile tickers, Uniswap mid/TWAP, CCL/MEP/crypto references
      - an inventory skew
      - an LLM risk-officer regime (calm / stressed / event)
      - social signals bought on buy
    - Hedges inventory drift on Uniswap. Keeps a P&L ledger.
    - Runs on a buy VM that it renews daily from P&L in USA₮ (blue/green handoff).
    - *AC:* `/desk` shows quoted volume, fills, P&L, and costs paid to buy with tx links.
12. **Language and voice.** Voice notes are transcribed (es/pt/en) and handled like text. Replies come in the user's language.

### P2: only if P0 and P1 are green by Day 7
13. **Vaquinha group mode.** Add the bot to a group, log expenses, settle each member in their own currency.
14. **WhatsApp channel.**
15. **wCOP corridor**, via x402 acceptance plus a desk quote if liquidity appears.

## Autonomy policy
| Action | Without asking | Needs a tap | Never |
|---|---|---|---|
| Read balances, quotes, rates | ✓ | | |
| Execute a user-initiated convert/send ≤ per-action cap | | ✓ (confirm button) | |
| Execute a standing rule within caps | ✓ (user pre-authorized the rule) | | |
| Anything above caps / new recipient > $50 | | ✓ (Mini App approval) | |
| Change caps, export keys, add session keys | | ✓ (Mini App + wallet signature) | |
| Move funds to an address the user never named | | | ✗ |

## Conversation design
- **Intents:** `balance`, `quote`, `convert`, `send`, `add_contact`, `rule_create/list/pause`, `receipt`, `help`, `deposit`, `withdraw_guide`, `limits`.
- **Confirmation pattern:** route card, then buttons **[Confirmar] [Ver alternativas] [Cancelar]**. Quotes expire on a visible countdown; on expiry, re-quote automatically once.
- **Tone:** warm, short, local. Use "vos" in Argentine Spanish. Use "você" in Brazilian Portuguese. Amounts always show both currencies.
- **Sample (es-AR):**
  > **Vos:** pasá 200 dólares a pesos
  > **Arbolito:** Te consigo **ARS 322.640** por 200 USA₮ (1 USD = 1.613,2). Ruta: USA₮→USDT (Uniswap 0,01%) → wARS (Textile, cotización firme, vence en 48s). Vs. dólar oficial: **+ARS 12.640**. [Confirmar] [Ver alternativas] [Cancelar]
- **Sample (pt-BR):**
  > **Você:** manda 200 reais pra Lucía em Buenos Aires
  > **Arbolito:** A Lucía recebe **ARS 61.260** (R$200 → USDT → wARS). Western Union cobraria ~R$… a mais (cotação capturada agora). [Confirmar] [Ver alternativas]
- **Errors:**
  - `no_quote`: "Ningún market maker cotizó ese monto ahora. ¿Pruebo con Uniswap o un monto menor?"
  - Slippage exceeded: abort, explain, re-quote.
  - Never leave the user unsure whether money moved. Always state the final state, with the tx link.

## Metric definitions (for `/metrics`)
- **Unique users:** wallets that completed ≥ 1 Arbolito transaction (tagged with the attribution code).
- **wFIAT volume:** sum of wARS/wBRL/wCOP legs in routes Arbolito executed, priced in USD at execution.
- **Savings vs official:** (executed rate − official rate) × amount, ARS corridor only. Show the median and the total.
- **Desk quoted volume:** sum of the notional of quotes Arbolito Desk returned to Textile RFQs. Fills and P&L are reported separately.
- **USA₮ settled:** count and $ of x402 settlements in USA₮ (buy purchases + FX API sales).
- **buy demand:** count and $ of paid buy calls, by capability.

## Non-goals
- No custody of user funds beyond what a smart account and scoped session keys need.
- No fiat rails of our own; off-ramp is via Ripio.
- No leverage, lending or yield. No new token.
