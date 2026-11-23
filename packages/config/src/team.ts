/**
 * The team's wallets that are already public in this repo's docs. Hackathon traction counts
 * only wallets outside the team that we never funded, and a Textile fill between our taker and our
 * own maker is self-trading. So:
 * - a team wallet is never counted as a user, and
 * - a team wallet never takes a firm quote that our own desk would fill (packages/config/src/team.ts
 *   is the one list both checks read).
 * Every other team wallet goes in the private TEAM_WALLETS env var (comma-separated), never here:
 * this repo is public. Set it wherever the web app runs, or those wallets are treated as outsiders.
 */
export const TEAM_WALLETS = {
  /** Ops / treasury and agent wallet (ERC-8004 #9976). */
  ops: "0x7e0316b2533F6dF2E651295A9B11481BB8346c3c",
  /** Arbolito Desk: the Textile maker (Stitch signs its orders). */
  desk: "0xBCB8B7dcEB8B39457Ef6D5dC95520A562b13EdbE",
  /** ArbolitoGuard operator (gas only). */
  operator: "0xeA7135ec38D6C289D781D22059eCf6007c6f36b4",
  /** Receipt anchor wallet (gas only). */
  anchor: "0x89dC45dF1AAbf0b0CeD75A56953129d6d8fF7CA4",
  /** First buy payer (2026-10-20). */
  buyPayer: "0xD07b5BD9C86eFB042af3343a9e4dae646f1f3e58",
  /** The founder's MiniPay wallet. */
  founderMiniPay: "0x7769A27123AaC03693065CD61A003C9DBb8BA734",
  /** The founder's second MiniPay wallet (runs the peso guardian; docs/STATUS.md, 2026-11-03). */
  founderMiniPay2: "0xDeE58b439A29d68d5c2cAc3c65C2504Beb7EeE9A",
} as const;

/** Makers that are ours: a fill by one of these for a team taker would be self-trading. */
export const OWN_MAKERS: readonly string[] = [TEAM_WALLETS.desk];

const lower = (a: string) => a.trim().toLowerCase();

/** The addresses in a comma-separated list, lowercased; anything else in it is ignored. */
export function addressSet(list?: string): Set<string> {
  return new Set((list ?? "").split(",").map(lower).filter((a) => /^0x[0-9a-f]{40}$/.test(a)));
}

/** Every team wallet, lowercased, plus any listed in `extra` (TEAM_WALLETS, comma-separated). */
export function teamWallets(extra?: string): Set<string> {
  return new Set([...Object.values(TEAM_WALLETS).map(lower), ...addressSet(extra)]);
}

/** The team wallets listed above: the only ones a public page may name as ours. */
export const isPublicTeamWallet = (a: string): boolean => Object.values(TEAM_WALLETS).some((w) => lower(w) === lower(a));

export const isOwnMaker = (maker: string): boolean => OWN_MAKERS.some((m) => lower(m) === lower(maker));
