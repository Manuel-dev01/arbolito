# Arbolito

**The autonomous cambista on open rails.** An *arbolito* is the Argentine street money-changer. This one is an AI agent on Celo. It:

1. **changes money for people** (wARS, wBRL, USA₮), always at a route it can prove;
2. **runs its own FX desk** on Textile;
3. **keeps its dollars in USA₮**;
4. **buys its own tools** (browsers, data, compute) on buy.

Built for **Celo, Agents on Open Rails** (kickoff 2026-10-06 12:00 GMT; deadline TBD, confirm on the hub).

| Track | Prize | What Arbolito brings |
|---|---|---|
| T1 Stable Agents: LatAm (Ripio) | $2K | Chat agent for holding, converting and sending wARS/wBRL; BRL⇄ARS cross-border; receipts for every route |
| T2a Open Corridors (Textile) | $1K | Real taker flow into Textile's empty wARS/wBRL corridors, plus Arbolito Desk as a filler |
| T2b Open Corridors (USA₮) | $1K | USA₮ treasury; every buy purchase and FX-API sale settles in USA₮ over x402 |
| T3 Build with buy | $1K | Pays buy for browser sessions, social data and its own VM |

## Start here
1. **[MASTER_PROMPT.md](MASTER_PROMPT.md)**: paste into a fresh Claude Code session opened in this folder to start the build.
2. **[CLAUDE.md](CLAUDE.md)**: standing rules every Claude Code session in this repo follows (loaded automatically).
3. **[PLAN.md](PLAN.md)**: strategy, scope cut lines, day-by-day roadmap, fallbacks.
4. **[docs/STATUS.md](docs/STATUS.md)**: live progress log. Update it as you go.

## Docs
| File | What's in it |
|---|---|
| [docs/01-research.md](docs/01-research.md) | Research tracks A–D, the five ideas, stress test, why Arbolito won, sources |
| [docs/02-product-spec.md](docs/02-product-spec.md) | Personas, user stories, flows, bot conversation design, feature acceptance criteria |
| [docs/03-architecture.md](docs/03-architecture.md) | System design, components, sequence flows, data model, security model, stack |
| [docs/04-reference.md](docs/04-reference.md) | Verified contract addresses, pools, endpoints, API notes and gotchas (canonical) |
| [docs/05-demo-submission-adoption.md](docs/05-demo-submission-adoption.md) | Demo script, submission checklist, per-track write-up templates, adoption campaign |
| [docs/06-outreach-drafts.md](docs/06-outreach-drafts.md) | Ready-to-send drafts: Textile key request, kickoff questions, launch posts (es/pt/en) |
| [.env.example](.env.example) | Every secret and config value the build needs |

## Critical path (do these first)
- [ ] Email Textile for a live API key and filler onboarding ([draft](docs/06-outreach-drafts.md#1-textile-api-key-and-filler-onboarding))
- [ ] Get an x402 facilitator API key (x402.celo.org)
- [ ] Ask the kickoff questions ([draft](docs/06-outreach-drafts.md#2-kickoff-questions-for-organizers))
- [ ] Fund the ops wallet (USA₮/USDT on Celo) and the buy wallet (~$10 USA₮)
