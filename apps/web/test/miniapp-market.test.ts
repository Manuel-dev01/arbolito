import { afterEach, describe, expect, it } from "vitest";
import { TOKENS } from "@arbolito/config";
import { GET as balancesRoute } from "../src/app/api/miniapp/balances/route";
import { GET as rateRoute } from "../src/app/api/miniapp/rates/route";
import { GET as receiptRoute } from "../src/app/api/miniapp/receipt/[id]/route";
import { BalancesResponse, RatesResponse } from "../src/lib/miniapp/contract";
import { setDeps } from "../src/lib/miniapp/server/deps";
import { ApiFailure } from "../src/lib/miniapp/server/errors";
import { getBalances } from "../src/lib/miniapp/server/market";
import { RateLimiter } from "../src/lib/miniapp/server/rate-limit";
import { ACCOUNT, BLOCK, makeRig } from "./miniapp-helpers";

afterEach(() => setDeps(undefined));

describe("GET /balances and /rates", () => {
  it("reads the 5 tokens at one block with USD values", async () => {
    const rig = makeRig();
    rig.chain.balances.set(`${TOKENS.USDT.address}:${ACCOUNT}`.toLowerCase(), 12_500_000n);
    rig.chain.balances.set(`${TOKENS.wARS.address}:${ACCOUNT}`.toLowerCase(), 16_000n * 10n ** 18n);
    rig.chain.quoterOut = (_t, a) => a / 10n ** 12n / 1600n; // wARS → USDT at 1600
    const b = BalancesResponse.parse(await getBalances(rig.deps, ACCOUNT));
    expect(b.blockNumber).toBe(BLOCK.toString());
    expect(b.balances.map((x) => x.sym)).toEqual(["wARS", "wBRL", "USDT", "USAT", "USDC"]);
    expect(b.balances.find((x) => x.sym === "wARS")).toEqual({ sym: "wARS", amount: (16_000n * 10n ** 18n).toString(), decimals: 18 });
    expect(b.usdMicros).toEqual({ wARS: "10000000", wBRL: "0", USDT: "12500000", USAT: "0", USDC: "0" });
  });

  it("route handlers validate the account and serve rates", async () => {
    setDeps(makeRig().deps);
    expect((await balancesRoute(new Request("https://arbolito.test/api/miniapp/balances?account=0x12"))).status).toBe(400);
    const ok = await balancesRoute(new Request(`https://arbolito.test/api/miniapp/balances?account=${ACCOUNT}`));
    expect(ok.status).toBe(200);
    const rates = RatesResponse.parse(await (await rateRoute()).json());
    expect(rates.references[0]).toMatchObject({ name: "official", pair: "USD/ARS", rate: "1500" });
  });

  it("receipt route: 404 for unknown ids, 400 for non-ids, not_ready without a database", async () => {
    setDeps(makeRig().deps);
    const params = (id: string) => ({ params: Promise.resolve({ id }) });
    expect((await receiptRoute(new Request("https://x"), params(crypto.randomUUID()))).status).toBe(404);
    expect((await receiptRoute(new Request("https://x"), params("../etc"))).status).toBe(400);
    setDeps({
      ...makeRig().deps,
      store: () => {
        throw new ApiFailure("not_ready", "no db", 503);
      },
    });
    const nodb = await receiptRoute(new Request("https://x"), params(crypto.randomUUID()));
    expect(nodb.status).toBe(503);
    expect((await nodb.json()).error.code).toBe("not_ready");
  });
});

describe("RateLimiter", () => {
  it("allows `limit` hits per window per key", () => {
    let t = 0;
    const rl = new RateLimiter(() => t);
    expect([rl.take("a", 2, 1000), rl.take("a", 2, 1000), rl.take("a", 2, 1000), rl.take("b", 2, 1000)]).toEqual([true, true, false, true]);
    t = 1000;
    expect(rl.take("a", 2, 1000)).toBe(true);
  });
});
