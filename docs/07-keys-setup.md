# 07: Keys and accounts setup

Where to get every `.env` value, and when you need it. Values go only in `.env` (gitignored). Never paste them into chat, commits or logs.

## Phase 1 (done)
| Key | Where to get it | Notes |
|---|---|---|
| `ATTRIBUTION_CODE` | Issued at hackathon registration (`celo_xxxxxxxx`). Ask the organizers in the hub or the Celo dev channels if you don't have one. | Mainnet sends refuse to run without it. Fork tests use a placeholder. |
| `OPS_PRIVATE_KEY` | Generate a fresh wallet: `cast wallet new`. Don't reuse a personal wallet. | Fund it with about **$6 of USDT on Celo plus ~1 CELO for gas** (see "Funding the ops wallet"). Deploys `ArbolitoReceipts` and runs the ≤ $2 smoke. |
| `TEXTILE_API_KEY` | Optional. Email contact@textilecredit.com (draft in [06-outreach-drafts.md](06-outreach-drafts.md)). | **Not needed:** taker paths are keyless (wallet-signed) and maker enrollment is self-serve. Still worth asking how "quoted volume" is measured. |
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
Do these in order; each is free to start unless noted.

| # | `.env` key(s) | Where to get it | Steps and notes |
|---|---|---|---|
| 1 | `DEEPSEEK_API_KEY` (plus `LLM_PROVIDER=deepseek`, `AGENT_MODEL`, `RISK_OFFICER_MODEL`) | **platform.deepseek.com** | Sign up → **Top up** a small prepaid balance (paid per token; $5 lasts a long time at hackathon volume) → **API keys** → *Create new API key*. It's shown once; paste it into `.env`. The API is OpenAI-compatible at `https://api.deepseek.com`. Defaults are `deepseek-chat` (agent) and `deepseek-reasoner` (risk officer); we confirm them with `GET /models` before building. |
| 2 | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` | **Telegram app → @BotFather** | Send `/newbot`, give it a name ("Arbolito") and a username ending in `bot` (e.g. `arbolito_cambio_bot`). BotFather replies with the token. For the webhook secret, generate any random string: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Later we set the Mini App with `/newapp` or `/setmenubutton`, once the web URL exists. |
| 3 | `STT_PROVIDER`, `STT_API_KEY` | **console.groq.com** (recommended, free tier, Whisper) or **console.deepgram.com** (free starter credit) | DeepSeek can't transcribe audio, so voice notes need their own provider. Groq: sign in → **API Keys** → *Create API Key*. Set `STT_PROVIDER=groq`. |
| 4 | `DATABASE_URL` | **neon.tech** (free tier) | Sign up → *Create project* (pick the region nearest your server) → **Connection string**, choosing the *pooled* option → copy the `postgresql://…?sslmode=require` URL. |
| 5 | `THIRDWEB_CLIENT_ID`, `THIRDWEB_SECRET_KEY` | **thirdweb.com → Dashboard** | Sign in (wallet or email) → *Create project* → copy the **Client ID** and the **Secret Key** (the secret is shown once). Under allowed domains add `localhost` and your Vercel domain. Smart accounts on mainnet may ask you to add a billing method for sponsored gas; we pay gas ourselves at first. |
| 6 | `PUBLIC_BASE_URL`, `MINI_APP_URL` | **github.com** (new repo) + **vercel.com** (free Hobby plan) | Push this repo to GitHub (a public repo is a submission requirement anyway; `.env` stays ignored). Vercel → *Add New Project* → import the repo → you get `https://<name>.vercel.app`. Use that for both keys. Telegram Mini Apps need HTTPS, and `vercel.app` qualifies, so a custom domain is optional. |
| 7 | (no key) bot hosting | **railway.com** or **fly.io** | An always-on host for `apps/agent`. Railway: sign in with GitHub → *New Project → Deploy from repo*; trial credit, then ~$5/month. Add the `.env` values in its Variables tab. Not needed until the bot runs 24/7. |
| 8 | `DESK_PRIVATE_KEY` | `cast wallet new` (local) | A separate wallet for Desk v0. **Don't fund it yet:** the inventory cap and amount need your approval first (`DESK_MAX_INVENTORY_USD`, default 500, which we'll set lower). |

No key is needed for Textile: taker quotes are keyless, and Desk maker enrollment is self-serve with a wallet signature.

## Phase 3+
| Key | Where to get it | Notes |
|---|---|---|
| `X402_API_KEY` | x402.celo.org | Needed for facilitator `/settle`. |
| `X402_PAY_TO` | Any address you control | Receives FX API payments. |
| `BUY_PAYER_PRIVATE_KEY` | `cast wallet new`, funded with ~$10 USA₮; also `npx @celo/buy setup` | Dedicated, capped. |
| `ERC8004_AGENT_ID`, `SELF_AGENT_ID` | Output of the identity registration (see [identity-steps.md](identity-steps.md)) | Founder-run. |

## Sandbox network allowlist (for Claude Code sessions)
`api.textilecredit.com`, `docs.textilecredit.com`, `api.x402.celo.org`, `x402.celo.org`, `gateway.usebuy.ai`, `usebuy.ai`, `docs.uniswap.org`, `developers.uniswap.org`, `docs.celo.org`, `raw.githubusercontent.com`.

Add for Phase 2: `api.deepseek.com`, `api-docs.deepseek.com`, `api.telegram.org`, `api.groq.com`, `*.neon.tech`, `*.thirdweb.com`, `api.thirdweb.com`. For the hackathon CLI (track rules): `www.loops.house`, `api.loops.house`, `*.supabase.co`.
