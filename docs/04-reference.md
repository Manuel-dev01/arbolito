# 04: Reference: addresses, pools, endpoints, gotchas (canonical)

Last verified 2026-10-04 via Celo mainnet RPC and live sponsor docs. **Re-verify before first use.** Read the chain and the live docs; never trust this file blindly. Update this file whenever something changes.

## Network
| | Value |
|---|---|
| Celo mainnet chainId | 42220 (`eip155:42220`) |
| Celo Sepolia chainId | 11142220 (`eip155:11142220`). **Textile does not support it.** |
| Public RPC | https://forno.celo.org |
| Explorer | https://celoscan.io |

## Tokens (Celo mainnet)
| Token | Address | Decimals | Notes |
|---|---|---|---|
| wARS | 0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d | 18 | Ripio. Supply ~262.7M (~$163K) |
| wBRL | 0xd76f5faf6888e24d9f04bf92a0c8b921fe4390e0 | 18 | Ripio. Supply ~3.71M (~$700K) |
| wCOP | 0x8a1d45e102e886510e891d2ec656a708991e2d76 | 18 | Ripio. ~$8.7K supply; x402-payable |
| wMXN | 0x337e7456b420bd3481e7fa61fa9850343d610d34 | 18 | Ripio. Seed supply only |
| wPEN | 0x4F34c8b3b5FB6D98Da888F0feA543d4d9C9F2eBE | 18 | Ripio. Seed supply only |
| wCLP | 0x61D450a098b6a7f69fC4b98CE68198fe59768651 | 18 | Ripio. Seed supply only |
| USA₮ | 0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771 | 6 | Anchorage/Tether. Fee adapter **0x0357EE22278c922e1D36cFe6b899269b161880C4** |
| USDT | 0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e | 6 | |
| USDC | 0xcebA9300f2b948710d2653dD7B07f33A8B32118C | 6 | |
| USDm (Mento) | 0x765DE816845861e75A25fCA122bb6898B8B1282a | 18 | |
| BRLm (Mento) | 0xe8537a3d056DA446677B9E9d6c5dB704EaAb4787 | 18 | Cross-issuer BRL |
| COPm (Mento) | 0x8A567e2aE79CA692Bd748aB832081C45de4041eA | 18 | Cross-issuer COP |
| cNGN | 0xF6829D7393dAe24509eb1E52eE8e572e2E271a4f | check | Textile corridor (desk) |
| CELO | 0x471EcE3750Da237f93B8E339c536989b8978a438 | 18 | |

**Fee abstraction:** for 6-decimal tokens, `feeCurrency` must be the **adapter** address, not the token. wFIAT tokens are **not** on the fee-currency allowlist. Sponsor gas, or pay it in USDT/USA₮/CELO.

## Uniswap v3 on Celo
- Factory: 0xAfE208a311B21f13EF87E33A90049fC17A7acDEc. Get QuoterV2 and SwapRouter02 addresses from Uniswap's Celo deployments page and record them here.

| Pool | Fee | Address | Balances (2026-10-04) | ≈ TVL |
|---|---|---|---|---|
| wARS/USDT | 0.01% | 0x5d8ef8b839be522b9e3d60a51edb5837cd0b2391 | 112.9M wARS + 38.3K USDT | ~$108K |
| wBRL/USDT | 0.01% | 0x01c3cf91cdf7b34181c7ec8566c0236951fea40f | 131.6K wBRL + 2.9K USDT | ~$28K (thin) |
| USA₮/USDT | 0.01% | 0x070d575a713eaf5025462d0865fb0dac4b14bc38 | 63.8K USA₮ + 42.2K USDT | ~$106K |
| USA₮/USDT | 0.05% | 0xae073a816117dcd1cc237fe4cb99f89f8f8bff4f | dust | — |

There are no USA₮/USDC or USA₮/USDm pools. Other wFIAT/quote pairs were not found at the 100/500/3000/10000 fee tiers against USDT, USDC, USDm, BRLm or CELO (scan of wARS, wBRL, wCOP and wMXN).

## Textile FX
- Docs: https://docs.textilecredit.com
  - API overview: `/api/`
  - OpenAPI spec: `openapi-v2.json`, linked from the docs. **Read it before coding.**
- REST base: `https://api.textilecredit.com/v2`. Keys `tx_live_…` (mainnet) and `tx_test_…` (BSC testnet 97 / Base Sepolia 84532 only). Request from contact@textilecredit.com.
- Public rates (no auth), cached for a few seconds:
  - `GET https://api.textilecredit.com/tickers`
  - `/pairs`
  - `/historical_trades?ticker_id=USDT_WBRL`
- Tickers: `USDT_WARS`, `USDT_WBRL`, `USDT_NGN`, `USDC_USDT`, `USDT_BRL`, `USDT_BRLA`, `USDT_TESOURO`, `USDT_IDR`, `USDC_ZARU`, …
- Celo corridors: cNGN↔USDT, USDC↔USDT, wARS↔USDT, wBRL↔USDT, IDRX↔USDT.
- RFQ semantics:
  - Firm quote bound to the taker wallet, ~60s TTL, **no partial fills**, `no_quote` possible.
  - v1 order-book endpoints are deprecated; `POST /v2/rfq/preview` gives indicative, unlocked depth.
- Fees: 1 bps taker fee on Celo, baked into the quoted rate. Makers earn their configured spread.
- Celo contracts:
  - LimitOrderReactor 0xa9AA0a64769cBed4d3B1Ceb4Df01CdE915C235b3
  - FeeController 0x7b005466F905DD882A959888154587fA76cd3Ea7
  - Permit2 0x000000000022D473030F116dDEE9F6B43aC78BA3
  - OperatorVaultFactory 0x88104decA449C797632AfdcA77A3140b24cD844A
  - VaultOrderExecutor 0x01b006d5c687bde182aa36F542f1f014144742e2
- Fillers: **Stitch** (open source; macOS/Windows/Linux).
  - `stitch.toml`: buy/sell offset bps, liquidity per side (`"max"` or a fixed cap), `limit_taker_enabled`.
  - `stitch approve` sets Permit2 allowances.
  - Polls an HTTP price feed. Config changes need a restart.

## Celo x402 facilitator
- Mainnet `https://api.x402.celo.org`; Sepolia `https://api.x402.sepolia.celo.org`.
- Endpoints:
  - `POST /verify` (open)
  - `POST /settle` (**X-API-Key**)
  - `GET /supported` (open)
  - `GET /health`
- `/supported` (2026-10-04):
  - x402 v2 and v1, `exact` scheme, network eip155:42220.
  - Extension `eip2612GasSponsoring`.
  - Assets: USDC (default), USDT and USA₮ via **eip3009**; **wARS, wBRL and wCOP via permit2**.
  - Facilitator signer 0x0d74D5Cefd2e7F24E623330ebE3d8D4cB45fFB48.
- Seller packages (v2): `@x402/express` or `@x402/hono`, plus `@x402/core` and `@x402/evm`. Use `HTTPFacilitatorClient` with `createAuthHeaders` for X-API-Key.
- Buyer header (v2): `PAYMENT-SIGNATURE`. Check `/supported` and the package docs for the permit2-asset `extra` fields.
- Alternative facilitator: thirdweb x402 (supports Celo).

## buy (x402 marketplace)
- Catalog (free): `https://gateway.usebuy.ai/v1/catalog`
  - 168 capabilities.
  - Payment: x402 **v1**, `exact`, payTo 0x20faAca5F980E29639A0FCC6dcA6988E18ed333B, tokens USDC/USDT/USA₮.
  - "The 402 challenge for the exact request is authoritative."
- Browser rental: `POST https://gateway.usebuy.ai/v1/browser/sessions` with `{"durationMinutes": 1|2|3|5|10}`.
  - Prices: $0.003606 / $0.004212 / $0.004818 / $0.00603 / $0.00906.
- Social and data (examples):
  - `x.posts.search` $0.006
  - `reddit.posts.search` $0.006
  - `youtube.videos.search` $0.006
  - `flights.search` $0.023
  - LinkedIn $0.023+
  - Apify, TikHub, MrScraper and Ploid providers
- Compute: `https://usebuy.ai/google/vm` (scripts), `/google/ssh`, `/google/catalog`.
  - e2-micro ~$0.0168/h; e2-small ~$0.0335/h; e2-medium ~$0.067/h.
  - e2-standard-2 and up need **Self attestation**.
  - 1h initial lease; renewals reboot the VM; **24h max lifetime**.
  - Egress allowed only on ports 53, 80, 443 and 123. **A denied connection hangs; wrap calls with timeouts.**
  - 10 GB egress cap per lease. 4 KiB script input. Poll URL = bearer capability.
- CLI and MCP: `npx --yes @celo/buy@0.8.1 setup --name buy`, then `npx --yes @celo/buy@0.8.1 mcp install --client all`.
  - MCP tools: `buy_pay_quote`, `buy_curl`, `buy_balance`, `buy_whoami`, `buy_verify_status`, `buy_discover`.
- Known issues:
  - #4: `buy curl` exits 0 on non-x402 responses; old demo providers are suspended.
  - #5: the gateway returns x402Version 1 while the facilitator uses 2.
- Get listed: open the "List your service" issue form in celo-org/buy-skill (curated).

## Identity, reputation, attribution
- ERC-8004 (mainnet):
  - Identity 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
  - Reputation 0x8004BAa17C55a88189AE136b182e5fdA19dE9b63
- ERC-8004 (Sepolia): Identity 0x8004A818BFB912233c491871b3d84c89A494BD9e; Reputation 0x8004B663056A597Dffe9eCcC1965A193B7388713.
- ERC-8004 usage:
  - Host the registration JSON (endpoints, `x402Support`), then `register(uri)` to mint the identity NFT.
  - Add the returned agentId to the JSON.
  - `giveFeedback` tags: `starred`, `uptime`, `successRate`, `responseTime`. Self-feedback reverts.
- Self Agent ID registry (mainnet) 0xaC3DF9ABf80d0F5c020C06B04Cced27763355944.
  - SDK `SelfAgent.fetch()` signs requests.
  - Services verify with `SelfAgentVerifier` (age, OFAC, sybil limit).
  - Registration is via CLI → QR → the Self app.
- Attribution: `@celo/attribution-tags`.
  - `toDataSuffix("celo_xxxxxxxx")`, appended as `data` or `dataSuffix`.
  - The code is issued via hackathon registration.

## Reference rates (benchmarks)
- Argentina: official, MEP, CCL, blue and crypto rates. Use a public dollar-rates API (e.g. dolarapi.com) and record the source in the ProofBundle.
- Textile tickers as the onchain FX reference.
- Competitor quotes (Western Union, Remitly, bank pages) captured via buy browser sessions.
