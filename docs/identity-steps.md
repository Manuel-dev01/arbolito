# Identity steps (founder-run)

Nothing here runs without your go-ahead. Both registrations are mainnet actions.

## 1. ERC-8004 agent identity
Registry: Identity `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` (Celo mainnet). `register(string)` was confirmed by a free `eth_call` simulation on 2026-10-09.

1. Set `PUBLIC_BASE_URL` in `.env`. Also export `TELEGRAM_BOT_HANDLE`, `FX_API_URL` and `MCP_URL` for the run (they fill the template).
2. `pnpm register:8004` renders `.arbolito/agent-registration.json` from `identity/agent-registration.template.json`.
3. Host that file over HTTPS. The plan is `apps/web` at `/.well-known/agent-registration.json`, which also proves domain control per ERC-8004.
4. Dry run: `pnpm register:8004 --uri https://<domain>/.well-known/agent-registration.json`. This simulates `register()` and prints the agentId you would get.
5. After your go-ahead: the same command with `--live`. Type `register` to confirm. It costs gas only, and the tx carries the attribution suffix.
6. Add `{"agentId": <id>, "agentRegistry": "eip155:42220:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432"}` to `registrations`, re-host the file, and set `ERC8004_AGENT_ID` in `.env`.

Registration file format: ERC-8004 `registration-v1`, with `services`, `x402Support: true`, `active` and `supportedTrust: ["reputation"]`, per the spec in ethereum/ERCs.

## 2. Self Agent ID (proof-of-human)
Registry: `0xaC3DF9ABf80d0F5c020C06B04Cced27763355944` (Celo mainnet). This matches the `@selfxyz/agent-sdk` README.

You need the Self app on your phone with your passport or ID already scanned.

1. Choose a mode. **`linked`** is recommended: the agent keeps its own keypair, linked to your human wallet.
2. In the repo, run `npx -y -p @selfxyz/agent-sdk@0.2.1 self-agent register init --mode linked --human-address <your wallet> --network mainnet --out .self/session.json`. The CLI **defaults to testnet**, so keep `--network mainnet`. It writes `.self/session.json` and `.self/agent.key` (both gitignored).
3. `npx -y -p @selfxyz/agent-sdk@0.2.1 self-agent register open --session .self/session.json` shows the QR code or deep link. Scan it with the Self app and approve. Disclosures: minimum age 18 and OFAC.
4. `npx -y -p @selfxyz/agent-sdk@0.2.1 self-agent register wait --session .self/session.json` waits for the onchain registration and prints the agentId.
5. Set `SELF_AGENT_ID` in `.env`. The agent private key stays in the session file or `.env`, never in git.

Notes:
- **Sybil limit:** verifiers allow one agent per human by default.
- **Expiry:** proofs expire, and re-registering needs a new passport scan.
- **License:** the SDK is BUSL-1.1. That's fine for using it; don't vendor its source.
