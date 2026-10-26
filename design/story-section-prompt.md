# Master prompt: the Arbolito story section

Paste everything below the line into Claude Design. Ask for divergent directions first, pick one or two, then iterate.

---

You are designing one section of a live product's landing page: the **origin story** of Arbolito. It must be the most memorable thing on the page, the part people screenshot and share. I want **divergent directions**, not variations of one idea.

## The product, in one breath
Arbolito is an AI money-changer for Latin America. You tell it "change 100 dollars to pesos" by text or voice in MiniPay (a stablecoin wallet) or on Telegram. It finds the best rate across onchain markets on Celo, converts into real local-currency stablecoins (Argentine pesos, Brazilian reais, Colombian and Mexican pesos), and hands you a receipt anyone can verify. No sign-up, no bank. Built by one founder for the Celo "Agents on Open Rails" hackathon.

## The story (the copy is fixed, so design around it)
The founder's line, verbatim:
> **In Buenos Aires, an "arbolito" is the guy on the street who changes your dollars. I built a digital one that lives in MiniPay and on Telegram.**

Section copy in English (Spanish and Portuguese follow; every design must survive all three, and Spanish runs ~20% longer):

| Beat | EN | ES | PT |
|---|---|---|---|
| Place | Calle Florida, Buenos Aires | Calle Florida, Buenos Aires | Calle Florida, Buenos Aires |
| Line 1 | In Buenos Aires, an *arbolito* is the guy on the street who changes your dollars. | En Buenos Aires, el *arbolito* es el que te cambia los dólares en la calle. | Em Buenos Aires, o *arbolito* é o cara na rua que troca os seus dólares. |
| Why | They're called arbolitos, little trees, because they stand on the same corner all day. | Les dicen arbolitos porque se plantan todo el día en la misma esquina, como árboles. | Chamam de arbolitos, arvorezinhas, porque ficam o dia todo plantados na mesma esquina. |
| Line 2 | I built a *digital one* that lives in MiniPay and on Telegram. | Hice uno *digital*, que vive en MiniPay y en Telegram. | Eu criei um *digital*, que vive no MiniPay e no Telegram. |
| Coda | The market rate, without the corner: on your phone, with a receipt anyone can check. | El precio del mercado, sin la esquina: en tu teléfono, con un comprobante que cualquiera puede verificar. | O preço do mercado, sem a esquina: no seu celular, com um comprovante que qualquer pessoa pode verificar. |
| CTAs | Open in MiniPay · or message @arbolitoo_bot | Abrir en MiniPay · o escribile a @arbolitoo_bot | Abrir no MiniPay · ou mande mensagem para @arbolitoo_bot |

## The real world to draw from (true details, use them)
- Arbolitos stand along **Calle Florida** in Buenos Aires' microcentro, murmuring "**¡Cambio, cambio!**", "**¡Dólar, euro, real!**", "**Compro dólares**" at passers-by. The calls stay in Argentine Spanish in every language version.
- They trade at the **dólar blue**, the informal street rate, which runs well above the official rate. Argentines check "el blue" daily, the way others check the weather.
- Deals happen in a **cueva** (an informal back-room exchange) or right there, bills counted fast by hand, often bundles of 100-peso notes.
- Argentina has several dollar rates at once: oficial, MEP, CCL (contado con liqui), blue, cripto. Arbolito's receipts compare against them. Real figure: one live receipt got **1,621.86 pesos per dollar, 5.31% better than the official rate**.
- Buenos Aires' visual vernacular: **fileteado porteño** (ornamental sign-painting with scrolls and shaded lettering), the **split-flap exchange boards** of old casas de cambio, yellow-and-black taxis, sodium street light, the obelisk.

## The brand (must feel like the same site)
- **Colors:** navy `#0b1220` (night, dark sections), off-white `#f2f3f7` (page background), muted ink `#4a5368`, hairline `rgba(11,18,32,0.1)`. Accents come from the logo, three dots of a little tree: **pink `oklch(0.6 0.24 350)`**, **blue `oklch(0.5 0.22 265)`**, **lime `oklch(0.89 0.2 125)`**.
- **Logo:** a tree made of three circles (blue on top, pink lower left, lime lower right) over a white rounded trunk, on navy. Any metamorphosis should land exactly on this mark.
- **Type:** *Instrument Serif* for display (italic for the emphasised word: "*arbolito*", "*digital*"), *Manrope* for body, *JetBrains Mono* for labels and numbers, *Archivo 800/900* for rare all-caps shouts.
- **The rest of the landing:** light glass cards over slowly turning 3D coins, big serif headlines with one italic coloured word, mono kickers numbered "01 — How it works", generous whitespace. The story is section "00", right after the hero, so it may break the light rhythm (a full-bleed dark night scene is allowed) but it must hand back cleanly to the light page.

## What I want from you
**Round 1: six divergent directions.** Each must differ in *concept* and *mechanic*, not just colour. For each, give:
1. A name and a one-line concept.
2. The **scroll storyboard**: what is on screen at 0%, 25%, 50%, 75% and 100% of the section's scroll, and how each beat hands off to the next.
3. The **metamorphosis**: how the street arbolito becomes the digital one (the logo, the phone, the chat) in one unbroken visual idea.
4. The desktop (1440) and mobile (390) layouts. On mobile the story must work one-handed, with no sideways scroll.
5. Its **unique move**: the one thing nobody has seen on a fintech landing page.
6. A hi-fi mock of the three key frames: opening, metamorphosis, closing with CTAs.

Starting points, to push past rather than copy:
- **"Pizarra":** an old casa de cambio split-flap board. The flaps clatter through COMPRA / VENTA and the blue rate, then resolve, letter by letter, into the story and finally the tree mark.
- **"Fileteado":** the story as a hand-painted fileteado sign, scrolls drawing themselves stroke by stroke in the brand colours; the central ornament blooms into the three-circle tree.
- **"Un plano secuencia":** one continuous camera move down Calle Florida at night (CSS 3D / SVG layers). Shopfronts slide past, murmurs float up, and the camera keeps pushing in until it lands inside a phone screen where the Telegram chat says "cambiá 100 dólares".
- **"Billete":** a 100-peso note folds and unfolds as you scroll; the story is printed in its microtext and the watermark, held to the light, is the tree.
- **"La conversación":** the street negotiation ("¿A cuánto está?" "Mil seiscientos." "¿Y si te doy quinientos?") typed as chat bubbles. Halfway, the speaker on the other side becomes the Arbolito bot, and the last message is a real receipt.
- **"Microcentro":** a top-down map of the microcentro. Every corner with an arbolito lights up pink, lime and blue; the lights drift together into one point, your phone.

Then invent at least two directions that are **not** on this list.

## Hard constraints (it ships in a real Next.js app)
- **Built from code, not stock imagery:** SVG, CSS and canvas only. No photos, no illustration packs, no Lottie files, no video backgrounds. Any figure is drawn from simple shapes, ideally the logo's circles and trunk.
- **One scroll variable:** the implementation has a single CSS custom property `--p` (0 to 1, the section's scroll progress) and optionally a second derived one. Describe every motion as a function of `--p`, so I can implement it with `calc()` and `clamp()`. No GSAP, no scroll-jacking: native scroll with a sticky stage about 3 to 3.5 viewport-heights tall.
- **Graceful without motion:** with `prefers-reduced-motion` or no JavaScript, the section renders as a static, complete layout showing all the copy and the final mark. Design that frame too.
- **Readable at every scroll position:** the text sits on an uncluttered area, contrast is at least WCAG AA, and the copy is real HTML text (not baked into SVG), so it's translatable and selectable.
- **Fast:** under 30 KB of extra code and assets, no layout shift, 60 fps on a mid-range Android phone, since that's who MiniPay users are.
- **Respectful:** this is a loving portrait of a Buenos Aires character, not a caricature. No sombreros, no gaucho clichés, no "shady dealer" framing, no tango-and-steak postcard. Arbolitos are a fact of daily life, and the tone is affectionate and a little nostalgic.

## Avoid
Generic parallax hills, floating 3D coins (the hero already has them), stick-figure clip art, gradients for their own sake, a cartoon mascot, anything that looks like a crypto template.

## Round 2 (after I pick)
For the chosen direction(s): refine the motion curve beat by beat, give exact sizes and spacing at 1440, 768 and 390, show the ES and PT copy in place, list every element with its `--p` keyframes, and give the static fallback frame.
