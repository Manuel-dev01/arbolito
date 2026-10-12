# 04: Reference: addresses, pools, endpoints, gotchas (canonical)

Last verified 2026-10-04 via Celo mainnet RPC and live sponsor docs; onchain entries re-verified 2026-10-07 by `pnpm verify:addresses` (67/67 at block 79491985). **Re-verify before first use.** Read the chain and the live docs; never trust this file blindly. Update this file whenever something changes.

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
| USA₮ | 0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771 | 6 | Anchorage/Tether. Onchain `symbol()` = `USAT`. Fee adapter **0x0357EE22278c922e1D36cFe6b899269b161880C4** |
| USDT | 0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e | 6 | Onchain `symbol()` = `USD₮`. Fee adapter **0x0E2A3e05bc9A16F5292A6170456A710cb89C6f72** |
| USDC | 0xcebA9300f2b948710d2653dD7B07f33A8B32118C | 6 | Fee adapter **0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B** |
| USDm (Mento) | 0x765DE816845861e75A25fCA122bb6898B8B1282a | 18 | |
| BRLm (Mento) | 0xe8537a3d056DA446677B9E9d6c5dB704EaAb4787 | 18 | Cross-issuer BRL |
| COPm (Mento) | 0x8A567e2aE79CA692Bd748aB832081C45de4041eA | 18 | Cross-issuer COP |
| cNGN | 0xF6829D7393dAe24509eb1E52eE8e572e2E271a4f | 6 | Textile corridor (desk). Decimals verified onchain 2026-10-07 |
| CELO | 0x471EcE3750Da237f93B8E339c536989b8978a438 | 18 | |

**Fee abstraction:** for 6-decimal tokens, `feeCurrency` must be the **adapter** address, not the token. wFIAT tokens are **not** on the fee-currency allowlist. Sponsor gas, or pay it in USDT/USA₮/CELO.
- Allowlist source: Registry `0x000000000000000000000000000000000000ce10` → `FeeCurrencyDirectory` `0x15F344b9E6c3Cb6F0376A36A64928b13F62C6276` → `getCurrencies()`.
- Read 2026-10-07: 21 currencies, including the three 6-decimal adapters above (USA₮ and USDT adapters expose `getAdaptedToken()`; the USDC adapter exposes `adaptedToken()`) and the Mento 18-decimal stables directly.

## Uniswap v3 on Celo
- Factory: 0xAfE208a311B21f13EF87E33A90049fC17A7acDEc
- QuoterV2: **0x82825d0554fA07f7FC52Ab63c961F330fdEFa8E8** (verified onchain 2026-10-07: `factory()` matches; struct-arg `quoteExactInputSingle` works)
- SwapRouter02: **0x5615CDAb10dc425a742d643d949a7F474C01abc4** (verified onchain 2026-10-07: `factory()` matches)
- Uniswap's docs site was not reachable from the build sandbox; confirm against the Celo deployments page when it is.

| Pool | Fee | Address | Balances (2026-10-04) | ≈ TVL |
|---|---|---|---|---|
| wARS/USDT | 0.01% | 0x5d8ef8b839be522b9e3d60a51edb5837cd0b2391 | 112.9M wARS + 38.3K USDT | ~$108K |
| wBRL/USDT | 0.01% | 0x01c3cf91cdf7b34181c7ec8566c0236951fea40f | 131.6K wBRL + 2.9K USDT | ~$28K (thin) |
| USA₮/USDT | 0.01% | 0x070d575a713eaf5025462d0865fb0dac4b14bc38 | 63.8K USA₮ + 42.2K USDT | ~$106K |
| USA₮/USDT | 0.05% | 0xae073a816117dcd1cc237fe4cb99f89f8f8bff4f | dust | — |

**TWAP oracle depth** (read 2026-10-09, `slot0().observationCardinality`; used by `ArbolitoSessionExecutor`'s 10-minute minOut floor):
- wARS/USDT and USA₮/USDT 0.01%: cardinality **1200** (next 1200). With ≤ 1 observation per 1 s block that always spans ≥ 20 min, so `observe([600, 0])` works.
- wBRL/USDT 0.01%: cardinality **1** (next 1). `observe([600, 0])` reverts `OLD` for 10 min after any swap that moves the tick, and otherwise just returns the current tick. The guard then needs an admin-signed reference price. Growing it is a permissionless `increaseObservationCardinalityNext(n)` on the pool (roughly 20–25k gas per slot, paid once).
  - **Done 2026-10-11** (founder-approved): `cardinalityNext` 1 → **64**, tx [`0x4706ee55…4dab`](https://celoscan.io/tx/0x4706ee5531188078be4c67b995b1d037196b57ebf80438eeff6d6f2828674dab), 1,430,446 gas ≈ 0.29 CELO, tagged `celo_e054d92430a5`. Cardinality grows into it as new observations are written.
  - Why 64: the pool had **0 swaps in the prior ~3 h**, so 64 slots is a wide margin for the 10-min window (`pnpm grow:oracle` can raise it later).

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
- **v2 RFQ taker flow (verified from `openapi-v2.json` + docs, 2026-10-09):**
  - **No API key needed for takers.** The partner key is optional on taker paths.
  - `POST /v2/rfq/preview`: free, anonymous, reserves nothing, no `taker`. Same body as request. Implemented in `TextileClient.preview`.
  - `POST /v2/rfq/request`: firm quote bound to `taker`.
    - Keyless callers send `takerProof`: an EIP-712 `TakerControl{taker,chainId,nonce(bytes32),issuedAt(ms)}` under domain `{name:"Textile Taker Control",version:"1",chainId}`. It's valid for 60 s, and one verified proof covers that wallet and chain for ~12 h.
    - Smart-contract takers verify via **EIP-1271, including counterfactual ERC-6492**.
    - **Proof of funds:** the taker must hold the sell token.
    - Returns `claimToken` (once), `quote` and `transactions.{approval,swap}`. The call blocks for up to ~70 s, so set a 75 s client timeout.
  - **The taker broadcasts settlement:** approve `takerPays` of the sell token to `quote.spender` (normally the reactor), then send `transactions.swap`, an `executeBatch` across the makers in the bundle. Always use `transactions.swap`, never the top-level `encodedOrder`.
  - `POST /v2/rfq/{id}/submit {txHash}` reports the fill, after which `GET /v2/rfq/{id}` gives status and `POST /v2/rfq/{id}/cancel` releases inventory. All three are authorized by the `X-Rfq-Claim: <claimToken>` header.
  - After `expiresAt`, `/submit` is rejected, but the signed order can still land until `orderDeadline`.
  - **Makers:** `POST /v2/maker/enroll` (wallet signature) issues a maker credential, followed by `/maker/verify-email` and `/maker/status`. Enrollment is self-serve, with no email required for onboarding.
  - Minimum size: about $1 notional. Fee: about 1 bps, taken in the sell token.
  - **Corridors seen:** a direct wBRL→wARS request returns 400 `corridor_unavailable`; route via USDT.
  - **Live preview on 2026-10-09:** 200 wBRL → 39.6855 USDT; 39 USDT → 62,620.30 wARS.
- **LimitOrderReactor is UniswapX's `LimitOrderReactor`** (onchain, 2026-10-09):
  - It exposes `execute`, `executeWithCallback`, `executeBatch` and `executeBatchWithCallback`.
  - `permit2()` is canonical Permit2; `feeController()` is the FeeController above; owner is `0x0Ddf1DBb612B07aFdAaE54a21e453bb36b3693a7`.
  - The swapper (signer) is the maker on RFQ, or the user on gasless limit orders. Its input is pulled by Permit2 `permitWitnessTransferFrom` with the UniswapX LimitOrder witness.
  - Fork test `contracts/test/fork/TextileReactorSmartAccount.t.sol` executes a LimitOrder whose swapper is an EIP-1271 contract wallet, and our witness hashing matches the reactor's.
- **Firm quotes are taker-exclusive onchain** (probe 2026-10-11):
  - **Probe:** one 1.1 USDT → wARS firm quote for the ops wallet, cancelled right after.
  - **What the order carries:** the maker's LimitOrder sets `additionalValidationContract = 0x10B9EbA3a175Df418a35CB8329a527691EE258C5`, whose data is `(uint256 exclusiveUntil, address[] fillers = [taker])`.
  - **Fork replay of the real signed order:**
    - submitted by any other address: reverts `0xa49d4044(filler, exclusiveUntil)`
    - submitted by the taker: settles exactly as quoted (1,764.51 wARS)
  - **Consequence:** only the taker address can be `msg.sender` of the reactor, so the session guard **cannot** fill a quote bound to a user's smart account. A session key must also never target the reactor directly: a hostile order would make the account pay its outputs.
  - **Textile for users therefore needs either:** (a) an admin-signed UserOp per Textile fill (the user signs in the Mini App), or (b) a per-user taker proxy that holds the sell token during the RFQ.
- Tickers live shape: an array of `{ticker_id, base_currency, target_currency, last_price, base_volume, target_volume, bid, ask, high, low}`, with numbers as strings. `USAT_USDT` is also listed.
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
- `/supported` re-read 2026-10-09: unchanged. v2 `exact` on eip155:42220 and v1 `exact` on `celo`, extension `eip2612GasSponsoring`, signer `0x0d74…FB48`.
- **ERC-8021 attribution on x402 settlements** (Celo team, 2026-10-08):
  - The facilitator submits `transferWithAuthorization`, so only it can append the Schema 2 tag. **Not live yet:** it's pending upstream in x402-rs/x402-rs#99, which has been tested on Celo Sepolia. Until it ships, settlements land onchain untagged.
  - **Seller (our FX API):** declare our code in the 402 response under `extensions["builder-code"].info.a`, using `declareBuilderCodeExtension` from `@x402/extensions` (2.28.0 on npm). The facilitator writes it as `a` (app) and adds its own `w`. No key or registration is needed. Add it now; nothing breaks before the facilitator ships.
  - **Buyer (our agent paying others):** put our code in the payment payload under `extensions["builder-code"].info.s` (service), using `BuilderCodeClientExtension`.
  - **Limits:** v2 payments only, since v1 (including buy) has no extensions field. USDC, USDT and USA₮ come first; wARS, wBRL and wCOP (Permit2 path) follow later.
  - **Crediting meanwhile:** the gateway attributes settlements to the API key that made them, and **judges credit by `payTo` address**.

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

## ERC-4337 / thirdweb smart accounts (Celo mainnet, verified 2026-10-09)
| Contract | Address | Notes |
|---|---|---|
| EntryPoint v0.6 | 0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789 | code present |
| EntryPoint v0.7 | 0x0000000071727De22E5E9d8BAf0edAc6f37da032 | code present |
| thirdweb AccountFactory v0.6 | 0x85e23b94e7F5E9cC1fF78BCe78cfb15B81f0DF00 | SDK `DEFAULT_ACCOUNT_FACTORY_V0_6` (5.121.6); impl `0xf22175c80c6e074C171811C59C6c0087e2a6a346` |
| thirdweb AccountFactory v0.7 | 0x4bE0ddfebcA9A5A4a617dee4DeCe99E7c862dceb | SDK `DEFAULT_ACCOUNT_FACTORY_V0_7`; impl `0x94eC38a5d2EDA5A543Ab4c08D998338D4082beb2`; `entrypoint()` matches |

- **`execute` access:** `execute` from a non-admin reverts "Account: not admin or EntryPoint.", so session keys act only through UserOps.
- **Self-bundling works:** Arbolito's relayer EOA calls `EntryPoint.handleOps` with ops at `maxFeePerGas = 0`. The account needs no CELO, and only the relayer pays gas. Proven by the fork test `packages/chain/test/smartAccount.fork.test.ts`.
- **Session-key scope** (`isValidSigner`):
  - call targets must be in `approvedTargets`
  - native value per call must be ≤ `nativeTokenLimitPerTransaction`
  - the key only works inside its time window, and grants are revocable (each signed request `uid` is single-use)
  - **There are no ERC-20 amount limits and no per-function limits.** A key scoped to SwapRouter02 can call `exactInputSingle(recipient = anyone)` or `pull` + `sweepToken`, so **never make a router or reactor a direct session-key target**. Route through an Arbolito guard contract instead.
- **Attribution:** tag both the outer `handleOps` calldata (credits the relayer) and the inner UserOp `callData` (`verifyUserOps` credits the smart account `sender`).
- **⚠️ Anvil's well-known dev addresses carry EIP-7702 delegations to sweeper contracts on Celo mainnet** (e.g. `0x7099…79C8` has code `0xef0100…`). Using one as relayer or beneficiary drained 10 CELO on the fork. **Never use or fund those addresses; production relayers must be fresh plain EOAs.**

## Arbolito contracts (Celo mainnet)
| Contract | Address | Notes |
|---|---|---|
| ArbolitoReceipts | **0x5C0b1208D81e0a44DEd74C7e01C54e8ee6b62d34** | Deployed 2026-10-09, block 79641781, tx `0xd3e1a5f6585c19d13d89491b47f597ed9b61f77fd074c9c14b86c30162ba421a`. Owner and emitter: ops wallet `0x7e0316b2533F6dF2E651295A9B11481BB8346c3c`. The deploy tx carries `celo_e054d92430a5` |

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

## Ripio ramps (wFIAT on/off-ramp)
From the Ripio team via the hackathon channel, 2026-10-08.
- **Hackathon path, no credentials:** URL-parameter deep links.
  - On-ramp: `https://ramp.ripio.com/`. Off-ramp: `https://ramp.ripio.com/offramp`.
  - **Params:**
    - `country`: ISO-2 (AR, BR, MX, CO)
    - `chain`: numeric chain ID (42220 for Celo)
    - `token`: e.g. `WARS`, `USDT`
    - `amount`
    - `address`: EVM destination
  - With country, chain, token and amount all present, the user goes straight into Ripio's flow. Otherwise the given params only prefill the form.
  - Ripio handles end-user KYC inside the flow. Availability of tokens and chains varies by country.
  - Example: `https://ramp.ripio.com/?country=AR&chain=42220&token=WARS&amount=10000&address=0x…`
- **Full API (Platform):** platform.ripio.com, with KYB for **legal entities only**. Partners request `client_id`/`client_secret` through support. A sandbox exists at skala-sandbox.ripio.com.
- **Design:** the Ripio integration goes behind an adapter. Deep links are the default, and API or sandbox access is optional if credentials arrive. The onchain part stays real on Celo mainnet.
- Ripio serves 6M+ users in LatAm.

## MiniPay (primary surface, verified from docs.minipay.xyz 2026-10-12)
- **Availability:** standalone Android/iOS in AR, BR, CL, CO, PE, UY, MX (and NG, KE, GH, ZA…).
- **Assets:** the wallet holds and shows only USDm, USDC and USDT; gas is paid in stablecoins (MiniPay may override `feeCurrency`). The provider is injected as `window.ethereum` (`isMiniPay`) and auto-connects: no connect button, no sign-in, and no auth-style message signing.
- **Deeplinks** (`https://link.minipay.xyz/…`):
  - `add_cash[?tokens=USDM,USDT,USDC]`
  - `miniapp?id=<Discover listing UUID>`: opens a mini app. The only supported way, and **it requires an approved Discover listing**.
  - `browse?url=` is deprecated: its whitelist isn't maintained for new mini-app domains.
  - `discover`, `receipt?tx=…[&celebrate]`, `qr`, `invite_friends`, `balance`
  - **Consequence:** until Arbolito is listed, links from Telegram open in the phone's browser (the app shows "Abrí Arbolito desde MiniPay"). Testing uses Developer Mode → "Load test page".
  - Query params passed through `miniapp?id=` are undocumented, so the Telegram "Confirmar en MiniPay" link may need the mini app to resume the user's latest open quote by wallet.
- **Listing:** submit through MiniPay's submission form (name, URL, 512×512 icon). It's curated (review → test → feedback → approval). Requirements: auto-connect, HTTPS, mobile-optimised, clear errors.

## Self Agent ID SDK
- `@selfxyz/agent-sdk` 0.2.1 (repo selfxyz/self-agent-id, BUSL-1.1).
- **CLI:** `self-agent register init|open|wait`. It **defaults to testnet**, so pass `--network mainnet`.
- **Modes:** self-custody, linked, wallet-free, ed25519, smartwallet. Mainnet registry `0xaC3DF9ABf80d0F5c020C06B04Cced27763355944`, which matches the entry above.

## Reference rates (benchmarks)
- Argentina: official, MEP, CCL, blue and crypto rates. Use a public dollar-rates API (e.g. dolarapi.com) and record the source in the ProofBundle.
  - In use: `https://dolarapi.com/v1/dolares`, which returns `[{moneda, casa, compra, venta, fechaActualizacion}]`. The `casa` values are oficial, blue, bolsa (MEP), contadoconliqui (CCL), mayorista, cripto and tarjeta. We use `venta`.
  - BRL→ARS official comes from `https://dolarapi.com/v1/cotizaciones` (the `BRL` row).
  - Avoid `br.dolarapi.com`: its USD row was stale (dated 2023) when read on 2026-10-07.
- Textile tickers as the onchain FX reference.
- Competitor quotes (Western Union, Remitly, bank pages) captured via buy browser sessions.
