# Arbolito: rules for every Claude Code session in this repo

Arbolito is a hackathon build for Celo "Agents on Open Rails". Read `PLAN.md`, `docs/STATUS.md` and the relevant `docs/0x-*.md` before starting work. `docs/04-reference.md` is the canonical source for addresses and endpoints. Never invent an address. Verify against the chain or the live docs, then update that file.

## Money safety (real funds, Celo mainnet)
- Textile has no Celo testnet and buy is mainnet-only. Treat **every transaction and every paid HTTP call as real money**.
- Never send a mainnet transaction or pay for anything without an explicit go-ahead from the user in the current session.
  - Caps apply even with approval: ≤ $5 per action while building and ≤ $25/day, unless the user raises them.
- **Quote before paying.** For any x402 or buy call: free quote first, then show token and amount, then pay.
- **Never blindly retry a paid call.** A 500, `provision_failed` or `settle_uncertain` may mean the payment already settled. Check onchain or the poll URL first.
- Test against an **anvil fork of Celo mainnet** (`anvil --fork-url https://forno.celo.org`) before any mainnet send. Firm Textile quotes and Uniswap swaps can be executed on the fork first.
- Every transaction Arbolito sends carries the ERC-8021 attribution suffix (`@celo/attribution-tags`, code in `ATTRIBUTION_CODE`).
- Hot wallets hold capped float only. The desk wallet's inventory is capped in config, and the cap is enforced in code before signing.

## Secrets
- Secrets live only in `.env` (gitignored). `.env.example` lists every variable; keep it in sync.
- Never print, log, commit or paste private keys, API keys or buy poll URLs. buy poll URLs are bearer capabilities; redact them in logs.

## Engineering conventions
- pnpm workspace monorepo, TypeScript (strict), Node 22+, viem. Foundry for contracts. Vitest for tests.
- Amounts are `bigint` in atomic units end to end. Format only at the UI edge. Token decimals: wFIAT = 18, USDT/USDC/USA₮ = 6.
- Every venue adapter returns a typed `Quote` with: venue, amounts, expiry, raw payload, block number. Every executed route produces a `ProofBundle`.
- Celo fee abstraction: pass the **adapter** address (not the token) in `feeCurrency` for 6-decimal tokens.
- x402: buy speaks **v1** (`X-PAYMENT` header); Celo's facilitator issues **v2** (`PAYMENT-SIGNATURE`). Support both explicitly. Treat a non-402 response from a paid endpoint as an error, not a success.
- Before writing any Anthropic SDK / Claude API code, load the `claude-api` skill.
- Keep `docs/STATUS.md` current. At the end of each work block, log what shipped, what's blocked and what's next.

## Git
- Small, focused commits with clear messages.
- **No AI attribution trailers.** No "Co-Authored-By: Claude" lines, no "Generated with Claude Code" lines in commits or PRs.
- Never commit `.env`, keys, wallet files or buy poll URLs.
