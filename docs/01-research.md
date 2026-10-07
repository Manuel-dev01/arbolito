# 01: Research and ideation record

Research was run 2026-10-04 from live sponsor docs, sponsor APIs and direct Celo mainnet RPC reads. No prior project memories were consulted, to keep ideation unbiased.

---

## Findings that shaped the strategy
1. **Only ARS and BRL are live wFIAT corridors on Celo.**
   - Supply: wBRL ~$700K, wARS ~$163K.
   - wCOP ~$8.7K; wCLP, wMXN and wPEN under $1.1K each.
2. **Textile's LatAm corridors are quoted but untraded.**
   - USDT↔wARS is quoted ~4 bps wide; 24h volume $0.
   - USDT↔wBRL is quoted ~8 bps wide; 24h volume ~$300.
   - USDT↔NGN did ~$199K in 24h.
   - Takers are the missing piece.
3. **Celo's x402 facilitator already settles wARS, wBRL and wCOP** (via Permit2), alongside USDC, USDT and USA₮ (via EIP-3009). Almost nobody uses local-currency x402 yet.
4. **buy is live with 168 paid capabilities** settling in USDC, USDT or USA₮:
   - agent browser rentals at $0.0036–$0.0091 per session
   - social data (X, IG, TikTok, Reddit, YouTube, LinkedIn)
   - flight search
   - GCP VMs (24h max, HTTPS egress allowed)

   buy uses x402 **v1**; the Celo facilitator is **v2**. Celo DevRel is actively dogfooding buy and filing bugs (buy-skill #4, #5).
5. **USA₮/USDT has a ~$106K Uniswap v3 pool at 0.01%.** USA₮ can be the treasury dollar with a cheap hop to USDT.
6. **The last Celo agent hackathon** ran 10 days and required a Karma project, an ERC-8004 agentId, Self verification and a tweet. Winners were praised for "genuine economic agency", "stablecoin-native infrastructure", "mobile-first UX" and "real utility, real payments, real distribution".
7. **Argentina:** August 2026 CPI +1.7% m/m. On 2026-09-28: official 1,550, MEP 1,551, CCL 1,617, crypto 1,615. That ~4% official-to-crypto gap is real value for anyone paid in USD.

---

## Track A: what makes these judges say "wow"
**General patterns**
- A live, working product with real money, not slides.
- A specific protagonist with a sharp problem.
- One jaw-drop moment in the first 30 seconds.
- One novel mechanism, shown rather than explained.
- Visible metrics.
- Polish.
- Sponsor tech that does real work, not decoration.
- A believable "what's next".

**This panel specifically**
- The rubrics are quantitative:
  - T1: functionality, utility, UX, onchain adoption
  - T2a: quoted volume, profit, innovation
  - T2b: real USA₮ settled
  - T3: problem, integration depth, demand created for buy
- Win conditions:
  - Live on mainnet.
  - A public metrics page.
  - Mobile-first chat UX.
  - ERC-8004 reputation.
  - Attribution tags, so the judges can count your transactions.
  - Hardening buy (handling the v1/v2 mismatch, filing upstream fixes), which reads as integration depth to the people who build it.
  - Bringing taker flow to Textile's empty LatAm corridors, which solves Textile's real problem.

## Track B: frontier tech and unfair advantages
1. **x402 priced and paid in pesos or reais.** The facilitator supports it today.
2. **Textile v2 RFQ.**
   - Firm, exclusive maker quotes with ~60s TTL; atomic settlement; gasless limit orders.
   - Stitch, the open-source filler, polls *your* HTTP price feed. An AI fair-value engine can drive it without writing a signer.
3. **buy as the agent's procurement layer.**
   - Browsers for JS-heavy pages with no API, social data for regime signals, VMs to self-host.
   - Each call is a USA₮ x402 settlement.
4. **USA₮ treasury.** The pool hop to USDT costs 0.01%. Fee abstraction lets USA₮ pay gas (use the adapter address).
5. **Identity, compliance and attribution.**
   - ERC-8004 identity and reputation.
   - Self Agent ID: proof-of-human, OFAC screening and sybil limits. It also unlocks Self-gated buy VM types.
   - ERC-8021 attribution tags.
6. **Smart accounts with scoped session keys**, for autonomy within caps.
7. **Claude tool-use agent**, plus speech-to-text for Spanish and Portuguese voice notes.
8. **Discovery.** Bazaar metadata, agent402.tools, the ERC-8004 registration file with `x402Support`, and a buy listing.

## Track C: five divergent concepts
1. **Arbolito (autonomous cambista).**
   - A chat agent that holds, converts and sends wARS, wBRL and USA₮.
   - Best-execution routing across Textile RFQ and Uniswap v3.
   - Verifiable route receipts: quotes, blocks and a live competitor capture via buy browsers, hashed onchain.
   - Arbolito Desk as a Textile filler.
   - An x402 FX API and MCP server so other agents can hire it.
   - *Tracks: T1, T2a, T2b, T3.*
2. **Índice (open price observatory).**
   - Context: Argentina's falsified CPI era produced MIT's Billion Prices Project.
   - Agents rent buy browsers to scrape supermarket prices, publish an inflation index anchored onchain, and sell it via x402 in wARS.
   - A savings agent uses the index to time dollarization.
   - *Tracks: T3, T1.*
3. **Peso402.**
   - Lets any agent pay any x402 API (including all 168 on buy) in wARS, wBRL or wCOP.
   - A netting settlement agent keeps a USA₮ float and rebalances on Textile; sellers are paid in USA₮.
   - *Tracks: T2b, T3, T2a, T1.*
4. **Vaquinha.**
   - A group-chat agent that tracks shared trip or household costs across ARS and BRL ("hacer una vaca" / "fazer uma vaquinha").
   - Settles each person in their own currency atomically.
   - *Tracks: T1.*
5. **Mesa.**
   - A regime-aware AI market maker for Textile (wARS, wBRL, cNGN).
   - Fair value from CCL/MEP/crypto references and pool TWAPs, an LLM risk officer fed by buy social data, and hedging on Uniswap.
   - Pays for its own VM.
   - *Tracks: T2a.*

## Track D: stress test (1–5; for risk, 5 = safest)
| Idea | T1 fit | Cross-track | Novelty | 10-day feasibility | Adoption in window | Dependency risk | **Total** |
|---|---|---|---|---|---|---|---|
| **Arbolito** | 5 | 5 | 4 | 3 | 4 | 3 | **24** |
| Vaquinha | 5 | 2 | 3 | 4 | 3 | 4 | 21 |
| Peso402 | 2 | 5 | 4 | 3 | 3 | 3 | 20 |
| Índice | 3 | 4 | 5 | 3 | 2 | 2 | 19 |
| Mesa | 1 | 2 | 3 | 4 | 2 | 2 | 14 |

**Key risks**
- **Arbolito:**
  - scope
  - Textile key latency
  - session keys or smart-account takers vs Textile settlement
  - the thin wBRL pool (~$28K)
- **Vaquinha:**
  - every friend first needs wFIAT on Celo (Ripio withdrawal friction)
  - weak USA₮ and buy story
  - social-finance concepts have already won Celo hackathons, so novelty is lower
- **Peso402:**
  - $0.006 micro-payments are far below FX ticket size, so it needs a netting float
  - v1/v2 mismatch
  - abstract UX loses T1
- **Índice:**
  - supermarket anti-bot defenses against datacenter IPs
  - nobody pays for an index within 10 days
  - methodology scrutiny
- **Mesa:**
  - near-zero LatAm taker flow means near-zero quoted volume unless it quotes cNGN
  - capital at risk
  - a single judge audience

## Why Arbolito
1. **It's one sentence.** An arbolito that changes money, runs a desk, keeps dollars in USA₮ and buys its own tools. Every sponsor's product does real work.
2. **It attacks the measured gap.** Textile's LatAm corridors have tight quotes and no takers. Arbolito is both taker flow and a maker.
3. **Two adoption engines:**
   - humans: USD-paid Argentine freelancers, BRL⇄ARS transfers
   - agents: the x402 FX API and MCP server for other teams
4. **Two novel mechanisms judges haven't seen:**
   - verifiable route receipts
   - a self-funding desk that rents its own server from buy
5. **It absorbs the best parts of the other ideas:** Mesa becomes the Desk, Peso402 becomes the FX API, and Vaquinha becomes an optional group mode.

---

## Sources
- Hackathon:
  - [Kickoff (Luma)](https://luma.com/uk27jw1q)
  - [Celo docs PR #2361](https://github.com/celo-org/docs/pull/2361)
  - [V2 winners](https://celo-devs.beehiiv.com/p/congrats-winners-build-agents-for-the-real-world-v2-results-are-out)
  - [Onchain Agents winners](https://celo-devs.beehiiv.com/p/congrats-onchain-agents-hackathon-winners)
  - [Previous format](https://celo-devs.beehiiv.com/p/build-agents-for-the-real-world-celo-hackathon)
- Ripio:
  - [wFIAT on Celo](https://blockchain.news/news/ripio-wfiat-stablecoins-celo-integration)
  - [Ripio wARS adoption](https://cointelegraph.com/news/argentine-exchange-ripio-peso-stablecoins)
- Textile:
  - [Docs](https://docs.textilecredit.com/)
  - [Become a filler](https://docs.textilecredit.com/guides/how-to-become-a-filler.html)
  - [Quoting](https://docs.textilecredit.com/guides/quoting-the-order-book.html)
  - [How it works](https://docs.textilecredit.com/how-it-works.html)
  - [Address book](https://docs.textilecredit.com/protocol/address-book.html)
  - [API](https://docs.textilecredit.com/api/)
  - [Rates](https://docs.textilecredit.com/api/rates.html)
  - [Testnet](https://docs.textilecredit.com/testnet.html)
- USA₮ and x402:
  - [Build with USA₮](https://docs.celo.org/build-on-celo/build-with-usat)
  - [The Block](https://www.theblock.co/post/410048)
  - [x402 on Celo](https://docs.celo.org/build-on-celo/build-with-ai/x402.md)
  - [x402 discovery](https://docs.celo.org/build-on-celo/build-with-ai/x402-get-discovered.md)
  - [MPP](https://docs.celo.org/build-on-celo/build-with-ai/mpp.md)
- buy:
  - [buy-skill](https://github.com/celo-org/buy-skill)
  - [#4](https://github.com/celo-org/buy-skill/issues/4)
  - [#5](https://github.com/celo-org/buy-skill/issues/5)
  - [Gateway PR #25](https://github.com/celo-org/buy-skill/pull/25)
  - [Catalog](https://gateway.usebuy.ai/v1/catalog)
- Identity and infra:
  - [ERC-8004](https://docs.celo.org/build-on-celo/build-with-ai/8004.md)
  - [Self Agent ID](https://docs.celo.org/build-on-celo/build-with-ai/self-agent-id.md)
  - [Attribution tags](https://docs.celo.org/build-on-celo/attribution-tags.md)
  - [Stablecoin contracts](https://docs.celo.org/tooling/contracts/stablecoin-contracts)
  - [Local stablecoins](https://docs.celo.org/build-on-celo/build-with-local-stablecoin.md)
- LatAm context:
  - [Argentina FX and inflation, Sept 2026](https://hacecuentas.com/blog/informe-financiero-argentina-2026-09)
  - [LatAm stablecoin payroll](https://blindpay.com/resources/more/stablecoin-payroll-latam-contractors)
