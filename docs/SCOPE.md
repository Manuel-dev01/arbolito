# Arbolito: build scope tracker

The one place to see what's done, what's next and what's left, mapped to how each track is
judged (docs/08-judging-criteria.md). Updated at the end of every work block, alongside the
STATUS.md log.

**Deadline:** Nov 9, 2026, 09:00 UTC. **Last updated:** 2026-10-19 (21 days left).

Legend: ✅ done and live · 🟡 partly done · ⬜ not started · 👤 needs the founder (a decision, an approval, money or an account)

---

## Next up (in order)
1. ✅ **Send to a contact** from the Mini App (2026-10-19): `POST /api/miniapp/send/prepare`. Same currency is one transfer. Cross currency pays the contact in the Uniswap swap, or forwards a Textile fill exactly. Receipts name the recipient.
2. ✅ **Receipts list** (2026-10-19): `GET /api/miniapp/receipts`, merged into the app on launch, so receipts survive a new phone or a cleared app. Incoming transfers in the feed are still to do.
3. ✅ **First real conversions through the Mini App** (2026-10-19) on the founder's phone: USDT→wARS, wARS→USDT, USDT→wBRL from the chat, and a send. Fixes from the test shipped; receipts now anchor live.
4. 🟡 **Autonomy:** ArbolitoGuard v2 deployed 2026-10-19 (`0x411E…1d33`), wired on Vercel. Next: standing rules (payday split, scheduled sends) executed by the operator.
5. 🟡 **Identity:** ERC-8004 registered 2026-10-19 (agentId 9976). Self agent ID: waiting for the founder's passport scan.
6. ⬜ **Desk v1:** a hedger (sell inventory above the cap back to USDT), quote and win-rate stats from Stitch, and a strategy write-up for the originality score.
7. ⬜ **T2b / T3** (if time): the x402 FX API paid in USA₮, and buy-powered competitor quotes.
8. 👤 **Submission package** by ~Nov 5: public repo, README for judges, demo video, the Loops entry.

---

## T1 Stable Agents: LatAm (wFIAT agent): the main track
| Criterion (20% each) | Item | State |
|---|---|---|
| Works on mainnet with real wFIAT | Mainnet wARS/wBRL conversions with anchored, verifiable receipts (`/r/<id>`) | ✅ |
| | Every tx carries the attribution tag `celo_e054d92430a5` (enforced in code; MiniPay keeps it intact) | ✅ |
| | A real user's conversion through the MiniPay Mini App (founder, 2026-10-19; receipts anchored and verified) | ✅ |
| Real use of wFIAT + Celo stack | Router: Uniswap v3 + Textile RFQ, best execution, Textile partner key | ✅ |
| | Gas paid in stablecoins (MiniPay pays in USDT itself; our sender supports fee adapters) | ✅ |
| | ERC-8004 identity registration (agentId 9976, URI served at `/.well-known/agent-registration.json`) | ✅ |
| | Self agent ID (session open; founder scans with the Self app) | 🟡 👤 |
| | x402 via Celo's facilitator (see T2b) | ⬜ |
| Agent autonomy and usefulness | Chat agent (DeepSeek) quotes and explains in es/pt/en, with voice notes | ✅ |
| | Guardrails: per-action and daily caps, simulate before send, never retry a paid call | ✅ |
| | "Let Arbolito act for you": ArbolitoGuard v2 live on mainnet (`0x411E…1d33`); onboarding txs from the Mini App | ✅ |
| | Standing rules: payday split, scheduled sends | ⬜ |
| UX a real person can use | Landing page (design implemented, 3D coins, live calculator) | ✅ |
| | MiniPay Mini App: all designed screens, auto-connect, amounts in local currency | ✅ |
| | Telegram bot: cards, `/conectar` linking (code typed in Settings → Telegram); auto-deploys from main | ✅ |
| | Send to a contact (same currency or with conversion; receipts name the recipient) | ✅ |
| | Receipts list from the server (incoming-transfer feed still to do) | ✅ |
| | Wallet-ownership signature on reject and link (MiniPay supports both signing methods) | ⬜ |
| | Mini App chat on Vercel (DeepSeek + voice; replies in the user's language) | ✅ |
| | MiniPay Discover listing (name, URL, 512×512 icon at `/arbolito.png`) | 👤 |
| Impact for LatAm | Story and numbers: the official-to-crypto dollar gap, BRL⇄ARS without SWIFT, the "Ahorraste" receipts | ✅ |
| | Named real users (a pilot group in AR/BR), with their conversions on `/metrics` | 👤 ⬜ |

## T2a Open Corridors: Textile FX (Arbolito Desk)
| Criterion | Item | State |
|---|---|---|
| Strategy P&L (40%) | Desk live on Railway: Stitch supervised inside `desk-feed`, 24/7 | ✅ |
| | Fair value from multiple sources, inventory skew that never crosses fair, circuit breaker | ✅ |
| | Hard inventory caps (buy side off at the cap) | ✅ |
| | LLM risk officer (pause-only, every 15 min) | ✅ |
| | Hedger: rebalance inventory above the cap back to USDT | ⬜ |
| Volume quoted and filled (30%) | Six corridors quoting: wARS, wBRL, USDC, USA₮, wCOP, wMXN (bid-only) | ✅ |
| | Fills ledger plus the `/desk` page (4 fills so far, all at positive edge) | ✅ |
| | App conversions routed through Textile, so they become RFQs the desk can win | ✅ |
| | Quote and win-rate stats (from Stitch logs) on `/desk` | ⬜ |
| | Optional: cNGN or IDRX corridors (listed in the track) | ⬜ |
| Originality (30%) | Devaluation-aware wARS pricing, depeg guard on stables, wMXN as the only bid | ✅ |
| | Strategy write-up for judges (docs/10-desk-plan.md, to be polished) | 🟡 |

## T2b Open Corridors: USA₮ with x402
| Criterion | Item | State |
|---|---|---|
| Real settlement via Celo's facilitator | x402 FX API (`apps/fx-api`, a stub today) selling quotes and conversions, paid in USA₮ | ⬜ |
| Named counterparty outside the team | Another team's agent, or a named business, paying for quotes | ⬜ 👤 |
| Repeat flow | The same payer calling repeatedly over the window | ⬜ |
| Why USA₮ | Treasury/savings dollar narrative; the `payTo` address in the submission | ⬜ |

## T3 Build with buy
| Criterion | Item | State |
|---|---|---|
| Use case | Competitor quotes (Western Union, Remitly, banks) captured by buy browsers into receipts | ⬜ |
| Depth | Verified paid buy calls from the tagged wallet | ⬜ 👤 (paid calls) |
| Demand | Driven by real user conversions | ⬜ |

## Infrastructure (done)
- ✅ pnpm/TS monorepo, verified mainnet config (72/72 checks), 396 unit tests, fork tests on anvil.
- ✅ ArbolitoReceipts `0x5C0b…2d34`; ProofBundle canonical JSON and keccak, anchored and verifiable in the browser.
- ✅ Vercel (`arbolito-livid.vercel.app`): landing, `/app` Mini App, `/r`, `/metrics`, `/desk`, `/minipay-check`.
- ✅ Railway: `arbolito-bot` (auto-deploys from main) and `desk-feed` (feed, Stitch, ledger, risk officer).
- ✅ Neon Postgres (migrations 0000–0004).

## Founder actions (open)
- [x] Do a real Mini App conversion on your phone (a few dollars).
- [x] Approve the ArbolitoGuard v2 deploy (deployed 2026-10-19).
- [x] Approve ERC-8004 registration and Self agent ID (ERC-8004 done).
- [ ] Scan the Self agent ID link with the Self app.
- [x] Add `DEEPSEEK_API_KEY` and `STT_API_KEY` to Vercel (Mini App chat).
- [ ] Submit the MiniPay Discover listing.
- [ ] Find 3–10 pilot users in AR/BR (named, with consent), for T1 impact.
- [ ] Decide when to make the repo public; approve the Loops entry draft.
