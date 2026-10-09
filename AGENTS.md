# Arbolito: rules for every Codex session in this repo

**Read `CLAUDE.md` first and follow it exactly.** It is the single source of truth for every coding agent in this repo, Codex included: money safety (real funds on Celo mainnet, the ≤ $5 per action and ≤ $25/day caps), secrets, engineering conventions and git rules. The rules live in one file on purpose, so the caps can't drift between agents. If anything here seems to conflict with `CLAUDE.md`, `CLAUDE.md` wins.

Then read `PLAN.md`, `docs/STATUS.md` (newest log entry first) and the relevant `docs/0x-*.md`. `docs/04-reference.md` is the canonical source for addresses and endpoints, and `docs/08-judging-criteria.md` holds the official judging criteria.

## Notes for Codex sessions
- `CLAUDE.md` mentions Claude Code skills (for example `claude-api`). Codex doesn't have those; skip those lines. The project's LLM provider is **DeepSeek** (OpenAI-compatible; see `packages/llm` and the Decisions section of `docs/STATUS.md`), so no Anthropic SDK code is needed.
- No AI attribution trailers in commits or PRs: no "Co-Authored-By" lines, no "Generated with …" lines.
