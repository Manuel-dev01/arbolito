# 07: Keys and accounts setup

Where to get every `.env` value, and when you need it. Values go only in `.env` (gitignored). Never paste them into chat, commits or logs.

## Phase 1 (now)
| Key | Where to get it | Notes |
|---|---|---|
| `ATTRIBUTION_CODE` | Issued at hackathon registration (`celo_xxxxxxxx`). Ask the organizers in the hub or the Celo dev channels if you don't have one. | Mainnet sends refuse to run without it. Fork tests use a placeholder. |
| `OPS_PRIVATE_KEY` | Generate a fresh wallet: `cast wallet new`. Don't reuse a personal wallet. | Fund it with about **$6 of USDT on Celo plus ~1 CELO for gas** (see "Funding the ops wallet"). Deploys `ArbolitoReceipts` and runs the ≤ $2 smoke. |
| `TEXTILE_API_KEY` | Email contact@textilecredit.com (draft in [06-outreach-drafts.md](06-outreach-drafts.md)). Ask for a `tx_live_` taker key and filler onboarding. | Critical path for T2a. `tx_test_` keys don't cover Celo. |
| `CELO_RPC_URL_FALLBACK` | Chainstack console: Celo mainnet node (hackathon Growth-plan perk). | Optional. Forno works without it. |

## Funding the ops wallet (no Ripio account needed)
wBRL and wARS are ordinary tokens on Celo, so the ops wallet can buy them onchain. A Ripio account only matters for Argentine or Brazilian users moving pesos or reais in and out. Ripio KYC is tied to its supported countries; don't try to pass it over a VPN, since that risks a frozen account.

1. Get **USDT on the Celo network** plus **~1 CELO** for gas into the ops address. Options:
   - **MiniPay** (Opera's Celo wallet, widely used in Nigeria). It has local deposit options; send USDT from it to the ops address.
   - **An exchange** that supports withdrawals **on the Celo network**. Check the network selector says Celo, not Ethereum or Tron, before sending. CELO is widely listed.
2. Buy wBRL through Arbolito itself. The guarded sender and caps apply, and this run gets a receipt too: `pnpm smoke:convert USDT wBRL 2.5 --live` (≈ 12.6 wBRL at 2026-10-09 prices).
3. Run the Phase 1 smoke: `pnpm smoke:convert wBRL wARS 10 --live`.

Gas can also be paid in USDT (`--fee-currency USDT`, via the fee adapter), but that path is untested; use CELO for the first runs.

## Phase 2
| Key | Where to get it | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com → API keys | Set a monthly spend limit. |
| `TELEGRAM_BOT_TOKEN` | @BotFather in Telegram → `/newbot` | `TELEGRAM_WEBHOOK_SECRET` is any random string you generate. |
| `THIRDWEB_CLIENT_ID`, `THIRDWEB_SECRET_KEY` | thirdweb.com dashboard → create a project | Smart accounts and session keys. |
| `STT_PROVIDER`, `STT_API_KEY` | console.groq.com (Whisper) or console.deepgram.com | Voice notes. |
| `DATABASE_URL` | neon.tech → new project → connection string | Postgres. |
| `DESK_PRIVATE_KEY` | `cast wallet new` | Fund only up to `DESK_MAX_INVENTORY_USD`. |
| `MINI_APP_URL`, `PUBLIC_BASE_URL` | Your Vercel deployment URL | |

## Phase 3+
| Key | Where to get it | Notes |
|---|---|---|
| `X402_API_KEY` | x402.celo.org | Needed for facilitator `/settle`. |
| `X402_PAY_TO` | Any address you control | Receives FX API payments. |
| `BUY_PAYER_PRIVATE_KEY` | `cast wallet new`, funded with ~$10 USA₮; also `npx @celo/buy setup` | Dedicated, capped. |
| `ERC8004_AGENT_ID`, `SELF_AGENT_ID` | Output of the identity registration (see [identity-steps.md](identity-steps.md)) | Founder-run. |

## Sandbox network allowlist (for Claude Code sessions)
`api.textilecredit.com`, `docs.textilecredit.com`, `api.x402.celo.org`, `x402.celo.org`, `gateway.usebuy.ai`, `usebuy.ai`, `docs.uniswap.org`, `developers.uniswap.org`, `docs.celo.org`, `raw.githubusercontent.com`.
