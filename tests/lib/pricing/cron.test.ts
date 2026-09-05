import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createDb } from "@/db/client";
import * as schema from "@/db/schema";
import { runExchangeRateCron } from "@/lib/pricing/cron";
import { seedDatabase } from "@/scripts/seed";

const ECB_XML = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope>
	<Cube><Cube time='2026-09-04'>
		<Cube currency='USD' rate='1.1622'/>
		<Cube currency='GBP' rate='0.85898'/>
	</Cube></Cube>
</gesmes:Envelope>`;

function stubFetch(response: Response): typeof fetch {
  return (async () => response.clone()) as typeof fetch;
}

beforeEach(async () => {
  await env.DB.exec("DELETE FROM exchange_rates");
  await env.DB.exec("DELETE FROM variant_prices");
  await env.DB.exec("DELETE FROM product_variants");
  await env.DB.exec("DELETE FROM product_use_cases");
  await env.DB.exec("DELETE FROM product_features");
  await env.DB.exec("DELETE FROM product_translations");
  await env.DB.exec("DELETE FROM products");
  await seedDatabase(createDb(env.DB));
});

describe("runExchangeRateCron", () => {
  it("stores rates and reprices in one pass", async () => {
    const outcome = await runExchangeRateCron(
      createDb(env.DB),
      stubFetch(new Response(ECB_XML)),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.date).toBe("2026-09-04");
    expect(outcome.result.updated).toBeGreaterThan(0);

    const rates = await createDb(env.DB).select().from(schema.exchangeRates);
    expect(rates.map((r) => r.quoteCurrency).sort()).toEqual(["EUR", "GBP"]);
  });

  it("prices EUR and GBP off the USD base price", async () => {
    await runExchangeRateCron(createDb(env.DB), stubFetch(new Response(ECB_XML)));

    const prices = await createDb(env.DB)
      .select()
      .from(schema.variantPrices)
      .where(
        eq(schema.variantPrices.variantId, "seed-variant-dn50-threaded"),
      );

    const eur = prices.find((p) => p.currency === "EUR");
    const gbp = prices.find((p) => p.currency === "GBP");

    // 9900 * 0.860437 * 1.03 = 8774.5 -> 8775 -> rounded to .99 -> 8799
    expect(eur?.amountMinor).toBe(8799);
    // 9900 * 0.739098 * 1.03 = 7536.5 -> 7537 -> rounded to .99 -> 7599
    expect(gbp?.amountMinor).toBe(7599);
    expect(eur?.source).toBe("auto");
  });

  it("reports failure without throwing when the feed is unreachable", async () => {
    const failing = (async () => {
      throw new TypeError("network unreachable");
    }) as typeof fetch;

    const outcome = await runExchangeRateCron(createDb(env.DB), failing);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(/network unreachable/);
  });

  it("keeps the previous snapshot when a later fetch fails", async () => {
    await runExchangeRateCron(createDb(env.DB), stubFetch(new Response(ECB_XML)));
    const before = await createDb(env.DB).select().from(schema.exchangeRates);

    await runExchangeRateCron(
      createDb(env.DB),
      stubFetch(new Response("boom", { status: 503 })),
    );

    const after = await createDb(env.DB).select().from(schema.exchangeRates);
    expect(after).toHaveLength(before.length);
    expect(after.map((r) => r.rate).sort()).toEqual(
      before.map((r) => r.rate).sort(),
    );
  });

  it("reports a non-2xx response as a failure", async () => {
    const outcome = await runExchangeRateCron(
      createDb(env.DB),
      stubFetch(new Response("nope", { status: 500 })),
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(/500/);
  });
});
