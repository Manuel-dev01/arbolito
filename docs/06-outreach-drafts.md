# 06: Outreach drafts (edit before sending)

## 1. Textile: API key and filler onboarding
**To:** contact@textilecredit.com
**Subject:** Agents on Open Rails hackathon: live RFQ key + filler onboarding (Celo wARS/wBRL)

> Hi Textile team,
>
> I'm building **Arbolito** for Celo's Agents on Open Rails hackathon (Open Corridors track). It's an agent that routes real LatAm user flow (BRL⇄ARS sends, USD→ARS conversions) into Textile RFQ on Celo, and runs a filler desk on the same corridors.
>
> Could you help with:
> 1. A **live v2 RFQ key** (`tx_live_`) so the agent can request firm quotes and settle as a taker on Celo (wARS↔USDT, wBRL↔USDT).
> 2. **Filler onboarding** for Stitch on Celo, quoting wARS, wBRL and cNGN.
> 3. Two quick questions for the track:
>    - How will "quoted volume" be measured for judging (quotes returned to RFQs, or filled notional)?
>    - Can a filler use a custom HTTP price feed with Stitch running headless on Linux?
>
> Wallet addresses (taker / filler): `0x…` / `0x…`
>
> Thanks! Happy to share progress as it goes live.
> [Your name] · [Telegram/X handle]

## 2. Kickoff questions for organizers
1. What is the submission deadline (date, time, timezone), and where is the hub/submission form?
2. Can one project be submitted to, and win, more than one track?
3. For T1 "onchain adoption": does wFIAT volume from agent-originated transactions count, or only human wallets? Will attribution codes be used to measure it, and where do we get ours?
4. Are ERC-8004 registration, Self verification and a Karma project required again?
5. Does Ripio offer a sandbox/API for builders, or confirmation that Celo withdrawals/deposits of wARS and wBRL are free in the Ripio app?
6. For T2b: does any real USA₮ x402 settlement count, including payments to buy?
7. For T3: will buy listing requests from hackathon teams be reviewed during the hackathon?

## 3. Message to other hackathon teams (Day 3–4)
> 👋 Building with wARS/wBRL and need to swap to USD (or pay x402 APIs in pesos)? **Arbolito** has an x402 FX API + MCP server on Celo:
> - `GET /v1/quote`: best route across Textile RFQ + Uniswap, with a verifiable receipt
> - `POST /v1/convert` / `POST /v1/send`: pay in USA₮, USDC, USDT, wARS, wBRL or wCOP
> - MCP: `npx arbolito-mcp`
>
> Docs: {link}. Happy to help you integrate.

## 4. Launch posts

**es-AR**
> Presentamos **Arbolito** 🌳💱: el arbolito que vive en tu Telegram.
> Cobrás en dólares, gastás en pesos: Arbolito busca el mejor precio entre mercados onchain (Textile + Uniswap en Celo), te da un **recibo verificable** de cada operación y lo pasás a tu banco gratis con Ripio.
> También manda reales ⇄ pesos entre Brasil y Argentina en segundos.
> Primeros 100 verificados con Self: primera operación sin comisión. 👉 {link}

**pt-BR**
> Conheça o **Arbolito** 🌳💱: a casa de câmbio que mora no seu Telegram.
> Mande reais e eles chegam como pesos na Argentina em segundos, pela melhor cotação entre mercados onchain na Celo, com **recibo verificável**.
> Também converte para dólar (USA₮) quando você quiser.
> Primeiros 100 verificados com Self: primeira operação sem taxa. 👉 {link}

**en**
> Meet **Arbolito**, an AI money-changer on Celo. It converts and sends pesos, reais and dollars at the best onchain route (Textile RFQ + Uniswap), proves every rate with an onchain receipt, runs its own FX desk, and pays for its own tools on buy in USA₮.
> Built for #AgentsOnOpenRails with @Celo @CeloDevs @RipioHQ @Textileprotocol @usat. 👉 {link}
