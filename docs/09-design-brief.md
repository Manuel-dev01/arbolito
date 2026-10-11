# 09: Design brief (starting prompt for Claude Design)

Paste everything below the line into Claude Design.

---

You're the product designer for **Arbolito**, a money app for people in Latin America. Design its full UX: the flows first, then the screens. Work like a senior product designer. Start with the users and their jobs, map the flows and information architecture, then design screens with every state, then a small design system. Ask me questions where something is unclear before going deep.

## The product in one line
**Arbolito is the money-changer that lives in your chat.** You tell it, by text or voice in Spanish, Portuguese or English, to change or send money between pesos, reais and dollars. It finds the best rate available right now, does it for you, and gives you a receipt that proves the rate.

## Why it exists
- In Argentina, "arbolito" is slang for the street money-changers on Calle Florida who call out "cambio, cambio". People trust them because they're fast and close, but you never know whether you got a fair rate.
- Arbolito is that, done right: fast, in your language, inside the chat app you already use, with **proof** that you got a good price.
- **The pain:** a Buenos Aires freelancer paid by a São Paulo agency loses money and days to fees and bad rates. Argentina's official dollar rate is about 4% worse than the "crypto dollar" rate people actually trade at. Sending reais to pesos usually goes through two expensive conversions.
- **What Arbolito does:** it converts directly between digital pesos, reais and dollars (Ripio's local-currency stablecoins on Celo) at market rates. A real conversion: **R$10 → ARS 3,177.41, 5.24% better than the official rate.**

## Who it's for
1. **Lucía (main persona)**, 29, freelance designer in Buenos Aires, paid in dollars by foreign clients. She wants pesos for rent and groceries at the best rate, and wants to keep savings in dollars. She isn't into crypto and shouldn't need to be. She cashes out through Ripio (a big Argentine fintech app).
2. **Agência Sol**, a small agency in São Paulo that pays Argentine contractors. It wants to send reais and have them arrive as pesos the same day, without bank transfer fees or waits.
3. **First-timers** who have never used crypto. If they can't finish the core flow, we've failed.
4. **Judges, partners and developers**, who look at the public receipts and live metrics to check that it's real.

## Brand and tone
- Warm, local, quick, trustworthy. Think "a friendly neighbourhood cambista with a calculator and a receipt book", not "crypto exchange".
- **Spanish first** (Argentine Spanish with *vos*: "pasá", "recibís"), plus Brazilian Portuguese (*você*) and English. Design for strings about 30% longer than English.
- **No crypto jargon in the main UI.** Say pesos, reais, dólares, cuenta, cambiar, enviar, recibir, comprobante. Never "wallet address", "gas", "token", "swap", "slippage", "smart account" or "session key" on primary surfaces. Put technical detail behind "Ver detalles" for those who want it.
- Amounts always show **both currencies** (e.g. "Recibís ARS 3.177,41 por R$ 10"), formatted for the locale (es-AR: `3.177,41`; pt-BR: `R$ 10,00`).
- **Brand assets:** we have none yet. Propose a wordmark and a simple mark, perhaps a small tree (arbolito = little tree) that's also a nod to the money-changer.

## Surfaces to design

### 1. Telegram chat (the main interface)
The bot (@arbolitoo_bot) is where most use happens. Telegram limits us to formatted text (bold, italic, links, code) plus inline buttons under a message.
- **Welcome** message after /start.
- **Quote card:**
  - you get X for Y
  - the rate
  - "vs official: +5.24%"
  - the route in plain words ("lo cambiamos en 2 pasos por el mejor mercado")
  - the guaranteed minimum
  - "expires in 48s"
  - buttons **[Confirmar] [Ver alternativas] [Cancelar]**
- **The other message states** (each with its message and buttons):
  - expired quote: re-quote
  - no market available
  - processing
  - done, with a receipt link
  - failed: always say "no money moved"
- Voice notes are transcribed and echoed back ("🎙️ 'manda 200 reais pra Lucía'") before the reply.

### 2. Telegram Mini App (a web app opened inside Telegram)
- **Platform constraints:**
  - mobile-only, 360–430 px wide
  - must follow Telegram's light/dark theme colours
  - uses Telegram's MainButton and BackButton patterns
  - respects safe areas
  - works on slow connections
- **Onboarding**, the most important flow:
  1. Welcome, with language picked automatically (changeable).
  2. Create your account by signing in with Telegram, Google or email. A secure account is created for them behind the scenes; never show "wallet".
  3. Choose limits in plain terms: "Arbolito can move up to US$25 per operation and US$100 per day without asking", shown in their own currency too, with clear defaults.
  4. **"Let Arbolito act for you"**, a consent screen that makes the safety model tangible:
     - Arbolito can only change money and send to *your saved contacts*, within your limits
     - the money always comes back to your account
     - access expires, and you can pause or revoke it anytime
     - one tap to approve
  5. Add money: through Ripio (pesos/reais from a bank, via a guided link) or by receiving dollars (USDT, USDC, USA₮). Show the account number/QR as a secondary detail.
  6. Done: "Write to Arbolito in the chat to change or send money."
- **Home:** total balance in the user's currency; balances by currency (Pesos, Reais, Dólares); quick actions **Cambiar, Enviar, Agregar dinero, Retirar**; recent activity.
- **Change money:** amount entry with a live quote (the same content as the chat card, with more room). States: loading, live with a countdown, expired → refresh, no market, price changed, processing, done → receipt.
- **Send:** pick or add a contact. If the contact receives a different currency, show "Lucía recibe ARS X". Confirm, then done.
- **Approval** for anything above the user's limits, or a new recipient over US$50: a clear "you're approving this" screen with a signature step.
- **Receipts list and receipt detail** (see 3).
- **Contacts:** add, edit, remove (adding needs approval).
- **Limits & security:** change limits (needs approval), pause Arbolito, revoke access, recovery.
- **Settings:** language, display currency.

### 3. Public receipt page (`/r/:id`, a shareable web page)
Every conversion gets a public receipt.
- **The plain-language story:** what you paid, what you got, how it compares to the official/MEP/CCL/crypto rates, how much you saved, the route, and the alternatives we checked.
- **A verification panel:** anyone can recompute the receipt's fingerprint and see it matches the one recorded publicly on the blockchain.
- **Design it for two readers:** Lucía, who wants "you saved ARS 158", and a judge, who wants proof. The verification should feel like a trust badge, not a wall of hex.

### 4. Public metrics (`/metrics`)
- **Live numbers:** users, transactions, volume by currency, receipts, median savings vs official, Arbolito Desk activity, dollar (USA₮) payments, and other apps paying for Arbolito's API.
- **Every number links to its proof** (a receipt or a blockchain transaction).
- **Refresh:** it updates every minute.

### 5. Arbolito Desk (`/desk`)
- **What it is:** Arbolito also acts as a market maker, quoting currency trades to others and earning a small spread.
- **What to show:** live quotes, fills, inventory by currency, profit and loss, the "market mood" its AI risk officer has set (calm / stressed / event), and the server costs it paid for itself.
- **Audience:** operator-grade but public, since judges look at it.

### 6. Landing page (`/`)
- **Hero:** "the money-changer that lives in your chat", with an Open in Telegram CTA.
- **How it works** in 3 steps.
- **A savings calculator** using live rates (R$/US$ → ARS vs the official rate).
- **"Every trade has a receipt anyone can verify"**, with a real receipt.
- **A live metrics teaser.**
- **Trust and safety** in plain words (your money, your limits, you can revoke).
- **FAQ:** Ripio cash-out, fees, which countries.
- **A footer** with language switch.

## UX principles (non-negotiable)
- **Never leave the user unsure whether money moved.** Every flow ends in an explicit state: done (with receipt), failed (nothing moved), or waiting (with what happens next).
- Quotes are time-limited: always show the countdown and what happens when it ends.
- Show both currencies. Lead with the user's own currency.
- Big tap targets, body text of at least 16 px, WCAG AA contrast, and both light and dark themes.
- Copy is short and kind. Errors say what happened, whether money moved, and what to do next.

## Real numbers to use in mocks
- Conversion: **10 wBRL (R$ 10) → 3,177.41 wARS (ARS 3.177,41)**, rate 1 BRL = 317.74 ARS, **+5.24% vs official** (BRL/ARS official 302.89).
- Argentina's dollar rates (ARS per USD): official 1,545 · MEP 1,541 · CCL 1,610 · crypto 1,608 · blue 1,555.
- Quote: 200 reais → about ARS 63,700, by changing reais → dollars → pesos.
- Default limits: US$25 per operation, US$100 per day.

## What I need from you, in order
1. **User flow map and information architecture** for the Mini App, chat and web, including the onboarding flow end to end.
2. **Low-fidelity wireframes** for the key flows: onboarding, change money, send to a contact, approval, receipt.
3. **High-fidelity screens** with all states (loading, empty, error, expired, success), light and dark, in Spanish with a pt-BR and English sample.
4. **A design system:** colour, type and spacing tokens, the core components (amount input, quote card, currency pill, balance row, contact row, receipt card, verification badge, buttons, toasts), and Telegram-theme mapping.
5. **A clickable prototype** of onboarding and change money.

## Build constraints (for handoff)
- **Web stack:** Next.js (App Router) + React, currently with plain CSS. Tailwind is fine if you recommend it.
- **Mini App:** Telegram Mini Apps SDK (theme params, MainButton, BackButton, haptics).
- **Sign-in and account:** handled by an embedded wallet SDK (thirdweb). The UI just needs "Continue with Telegram / Google / email".
- **Already live:** `/`, `/r/[id]` and `/metrics` at https://arbolito-livid.vercel.app (functional v0, unstyled). Redesign them.
