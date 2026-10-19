# Identity steps (founder-run)

Nothing here runs without your go-ahead. Both registrations are mainnet actions.

## 1. ERC-8004 agent identity: done 2026-10-19
Registry: Identity `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` (Celo mainnet).

- **agentId 9976**, owned by the ops wallet `0x7e03…6c3c`. Tx [`0xbb465125…ce89`](https://celoscan.io/tx/0xbb465125ec0aa57324ab3ee39887755504222813a8341c45486abf9a95d5ce89), tagged `celo_e054d92430a5`.
- Agent URI: `https://arbolito-livid.vercel.app/.well-known/agent-registration.json`, served by `apps/web` from `apps/web/src/lib/agent-registration.ts`. It lists only live services; add the x402 FX API and MCP there when they ship (same URI, no new tx). `ERC8004_AGENT_ID=9976` fills `registrations`.
- Re-run: `pnpm register:8004` fetches and checks the hosted file and simulates; `--live` registers (a new id each time, so don't).

## 2. Self Agent ID (proof-of-human)
Registry: `0xaC3DF9ABf80d0F5c020C06B04Cced27763355944` (Celo mainnet). This matches the `@selfxyz/agent-sdk` README.

You need the Self app on your phone with your passport or ID already scanned.

1. Choose a mode. **`linked`** is recommended: the agent keeps its own keypair, linked to your human wallet.
2. In the repo, run `npx -y -p @selfxyz/agent-sdk@0.2.1 self-agent register init --mode linked --human-address <your wallet> --network mainnet --out .self/session.json` (2026-10-19: started with the founder's MiniPay wallet `0x7769…a734`; agent address `0x91B96419466f04Db08ca2eA71027196FcdfC7c14`). The CLI **defaults to testnet**, so keep `--network mainnet`. It writes `.self/session.json` and `.self/agent.key` (both gitignored).
3. `npx -y -p @selfxyz/agent-sdk@0.2.1 self-agent register open --session .self/session.json` shows the QR code or deep link. Scan it with the Self app and approve. Disclosures: minimum age 18 and OFAC.
4. `npx -y -p @selfxyz/agent-sdk@0.2.1 self-agent register wait --session .self/session.json` waits for the onchain registration and prints the agentId.
5. Set `SELF_AGENT_ID` in `.env`. The agent private key stays in the session file or `.env`, never in git.

Notes:
- **Sybil limit:** verifiers allow one agent per human by default.
- **Expiry:** proofs expire, and re-registering needs a new passport scan.
- **License:** the SDK is BUSL-1.1. That's fine for using it; don't vendor its source.
