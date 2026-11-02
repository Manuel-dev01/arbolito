# Arbolito: 5-minute demo shot list

Every step is a real action on Celo mainnet, so this doubles as the path a tester follows.
Each step says **what to do**, **what you should see**, and **what to capture**.

- 📸 = screenshot · 🎥 = short screen recording (3–8 s; only where motion sells it)
- Save files to `design/demo/shots/` named by step, e.g. `3.4.png` or `4.2.mp4`
- Something went wrong? Capture it anyway, name it `3.4-error.png`, and keep going. It's a bug report.

---

## Before you start (10 min)

- [ ] **Phone:** Do Not Disturb on, brightness up, battery charged, one theme (light *or* dark) for the whole shoot.
- [ ] **Desktop:** Chrome, window about 1440×900, zoom 100%, bookmarks bar hidden, no other tabs.
- [ ] **MiniPay holds about US$ 8 in USDT** (the demo spends about US$ 3–4; gas is paid in USDT, cents).
- [ ] **Pick the app language.** English is easiest to shoot; Spanish looks more local. Either works: the table below gives both words.

### Spanish → English, for the app's buttons
| In the app (Spanish) | Means | Where |
|---|---|---|
| **Empezar** | Get started | first screen |
| **Lo hago después** | I'll do it later | "add money" screen on first launch |
| **Inicio** | Home | bottom bar, 1st tab |
| **Chat** | Chat | bottom bar, 2nd tab |
| **Comprobantes** | Receipts | bottom bar, 3rd tab |
| **Ajustes** | Settings (not "adjust") | bottom bar, 4th tab |
| **Idioma** | Language | inside Ajustes |
| **Moneda para mostrar** | Display currency | inside Ajustes |
| **Límites y seguridad** | Limits & security | inside Ajustes |
| **Confirmar en MiniPay** | Confirm in MiniPay | quote card |
  Colombia is the story: pesos colombianos, then reais or pesos argentinos for the remittance part.
- [ ] Save one contact in Send → Add (a second wallet of yours or a friend's), e.g. "Mamá".
- [ ] Telegram open on the desktop (Telegram Desktop or web.telegram.org) for Act 4.

If MiniPay blocks screenshots on its confirmation sheet, take a photo of the phone with another device, or skip it: I can recreate that sheet.

---

> ✅ **Acts 1 and 2 are captured already** (driven by script from the live site, Spanish and English):
> `design/demo/shots/{es,en}/` holds `1.1.png`, `1.2.webm` (story scroll video), `1.3-a…e.png`, `2.1.png`, `2.2.png`, `2.3-a.png`, `2.3-b.png`. Nothing to do for you there.

## Act 1. The hook (0:00 – 0:25), desktop

| # | Do | You should see | Capture |
|---|---|---|---|
| 1.1 | Open **arbolito-livid.vercel.app** | Hero: **"El cambista que vive en tu chat."** with a real receipt beside it | 📸 hero, full window |
| 1.2 | Scroll slowly into the story ("Calle Florida, Buenos Aires") | The street chat: *¿A cuánto está?* · *Mil seiscientos.* · the bills animating as you scroll | 🎥 6–8 s scroll |
| 1.3 | Stop on the story's last frame | *"Hice uno digital, que vive en MiniPay y en Telegram."* | 📸 |

## Act 2. The problem: too many rates (0:25 – 0:50), desktop

| # | Do | You should see | Capture |
|---|---|---|---|
| 2.1 | Scroll to **02 — Cuánto ahorrás** (wait for live prices to load) | The calculator: what you get at the official, blue, MEP, CCL and crypto rates, and at Arbolito | 📸 |
| 2.2 | Type 100 in the calculator | What 100 dollars gets at each rate; Arbolito's line highlighted | 📸 |
| 2.3 | Scroll to **03 — La prueba** and **04 — En vivo** | A real receipt ("Ahorraste"), and live numbers that link to their proof | 📸 each |

## Act 3. Change dollars to pesos colombianos in MiniPay (0:50 – 2:20), phone

| # | Do | You should see | Capture |
|---|---|---|---|
| 3.1 | MiniPay → Settings → About → tap the version number until developer mode turns on | "Developer mode" toast | 📸 |
| 3.2 | Settings → Developer Settings → **Load test page** → **clear the field first** (it keeps the last address) → type `https://arbolito-livid.vercel.app/app` → Load | Arbolito loading inside MiniPay | 📸 |
| 3.3 | **First launch only:** tap **Empezar** (Get started), and on the "add money" screen tap **Lo hago después** (I'll do it later) until you reach Home. **Then set the currency:** tap **Ajustes** (Settings, 4th tab at the bottom) → **Idioma** (Language) if you want English → **Moneda para mostrar** (Display currency) → **Pesos COP** → tap **Inicio** (Home, 1st tab) | Home reads "Tu plata, en pesos colombianos" ("Your money, in Colombian pesos"), with your balances and the four tabs at the bottom | 📸 the currency list · 📸 Home |
| 3.4 | Chat tab → type **"cámbiame 2 dólares a pesos colombianos"** (or hold the mic and say it) | Your message, then Arbolito's reply with a quote card | 🎥 typing → reply · 📸 the card |
| 3.5 | Look at the quote card | **Pagás US$ 2 · Recibís COP ~6.400**, the rate, the comparison with the interbank rate, a countdown | 📸 close-up |
| 3.6 | Tap **Confirmar en MiniPay** | MiniPay's own confirmation sheet (first: approve, then: the swap) | 📸 each sheet |
| 3.7 | Confirm both | **"Haciendo el cambio"** with progress | 🎥 3–5 s |
| 3.8 | Wait | **"Listo. Recibiste COP 6.4xx"** | 📸 |
| 3.9 | Open the receipt (Comprobantes → the newest) | Pagaste / Recibiste, how it compares, "verified" badge | 📸 |
| 3.10 | Tap **Ver detalles técnicos** | The transaction and the record (anchor) hashes | 📸 |
| 3.11 | Tap **Ver comprobante público** (it opens in the browser; open the same link on the desktop) | Public receipt page: the fingerprint matches the record on Celo | 📸 desktop |

> Testers: stop here if you only want to try one change. **Minimum is US$ 1** for pesos colombianos.

## Act 4. Same agent on Telegram, by voice (2:20 – 3:05), desktop + phone

| # | Do | You should see | Capture |
|---|---|---|---|
| 4.1 | Open **t.me/arbolitoo_bot** → Start | Welcome in Spanish with a **"Conectá tu MiniPay"** button | 📸 |
| 4.2 | Tap the button | A 4-digit code, valid 10 minutes | 📸 |
| 4.3 | Phone: Arbolito → Ajustes → Telegram → type the code | "Conectado" | 📸 phone |
| 4.4 | Telegram: send a **voice note**: *"¿cuánto me dan por 10 dólares en reales?"* | The transcript, then a quote with **vs Western Union** | 🎥 sending the voice note · 📸 the reply |
| 4.5 | Save the contact in the bot (its contacts are separate from the phone's): *"guardá a Mamá: 0x…"* (her address). Then: *"mandale 1 dólar a Mamá en reales"* | "Guardé a Mamá", then a send card with **"Confirmar en MiniPay"** | 📸 the card |
| 4.6 | Tap it, confirm in MiniPay | The send completes; Telegram gets the receipt | 📸 phone done screen · 📸 Telegram receipt message |

## Act 5. Let it act on its own, within your limits (3:05 – 4:00), phone

| # | Do | You should see | Capture |
|---|---|---|---|
| 5.1 | Ajustes → **Límites y seguridad** → **Activar Arbolito por vos** | **"Dejá que Arbolito actúe por vos"**: payday split, monthly payments, Telegram updates | 📸 |
| 5.2 | Next → **"¿Hasta cuánto puede mover sin preguntarte?"** | Cuidadoso / Recomendado / Amplio / **Personalizado** | 📸 |
| 5.3 | Pick **Personalizado**, enter 5 per operation and 20 per day | The two inputs filled | 📸 |
| 5.4 | Continue → contacts → consent | Who it can pay, what it can never do | 📸 consent |
| 5.5 | Confirm the MiniPay sheets (permissions are set onchain, in the guard contract) | "Arbolito ya puede actuar por vos" | 📸 |
| 5.6 | Chat: *"cuando me lleguen más de 1 dólar, pasá el 50% a reales"* | A rule card to sign | 📸 |
| 5.7 | Sign it in MiniPay | The rule shows as active | 📸 |
| 5.8 | Tell me in chat when 5.7 is done. I'll send US$ 2 from the e2e wallet (with your OK), the rule fires, and Arbolito converts half **without you touching anything** | Telegram: "I acted for you…"; a new receipt in Comprobantes | 📸 Telegram message · 📸 receipt |

> Rules work for pesos argentinos and reais (they route through Uniswap). Pesos colombianos are for changes you confirm yourself.

## Act 6. It's all onchain and checkable (4:00 – 4:40), desktop

| # | Do | You should see | Capture |
|---|---|---|---|
| 6.1 | Open **arbolito-livid.vercel.app/desk** | Arbolito Desk: what it's quoting now, fair prices, uptime | 📸 top |
| 6.2 | Scroll to the fills table | Fills with time, side, price vs fair, transaction links | 📸 |
| 6.3 | Open **/metrics** | The Western Union reads paid over x402 through buy, the agent wallet | 📸 |
| 6.4 | Click one transaction from 3.10 on Celoscan → "Input Data" | The calldata ends with our attribution tag | 📸 |
| 6.5 | 8004scan.io → search agent **9976** | Arbolito's onchain agent identity | 📸 |

## Act 7. Close (4:40 – 5:00)

| # | Do | Capture |
|---|---|---|
| 7.1 | Back to the landing hero | 📸 (or reuse 1.1) |
| 7.2 | Nothing to shoot: I'll end on the tagline, the links (app, Telegram, desk) and the tester call | – |

---

## What to send me
1. The `design/demo/shots/` folder (or a zip) with every file named by step.
2. One line on anything that looked wrong or slow.
3. Language for captions: English (judges) with the app in Spanish, or Spanish throughout?

I'll cut it into a 5-minute demo in the launch reel's style: the real screens framed on a device, timed captions, and a short version for X.

## Budget for one full run
About US$ 3–4 from your MiniPay: 2 (Act 3) + 1 (Act 4 send) + cents of gas. Plus US$ 2 from the e2e wallet for Act 5, after your OK. Most of it stays in your wallet as pesos or reais.
