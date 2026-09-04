import { describe, expect, it } from "vitest";
import { SITE } from "@/config/site";
import { breadcrumbJsonLd, productJsonLd, buildUseCaseJsonLd } from "@/lib/seo/jsonld";

const variants = [
  {
    id: "v1",
    sku: "BV-316L-DN50-NPT",
    stock: 120,
    optionValues: { connection: "NPT threaded" },
    moq: 10,
    leadTimeDaysMin: 15,
    leadTimeDaysMax: 20,
    priceMinor: 9900,
    priceCurrency: "USD" as const,
  },
  {
    id: "v2",
    sku: "BV-316L-DN50-FLG",
    stock: 0,
    optionValues: { connection: "ANSI 150 flanged" },
    moq: 5,
    leadTimeDaysMin: 25,
    leadTimeDaysMax: 35,
    priceMinor: 16800,
    priceCurrency: "USD" as const,
  },
];

const base = {
  name: "Stainless Steel Ball Valve DN50",
  description: "Full-bore 316L ball valve.",
  url: `${SITE.url}/en/products/stainless-ball-valve-dn50`,
  variants,
};

describe("productJsonLd", () => {
  const ld = productJsonLd(base) as Record<string, unknown>;
  const offers = ld.offers as Record<string, unknown>[];

  it("declares a Product with schema.org context", () => {
    expect(ld["@context"]).toBe("https://schema.org");
    expect(ld["@type"]).toBe("Product");
    expect(ld.name).toBe(base.name);
  });

  it("emits one offer per SKU", () => {
    expect(offers).toHaveLength(2);
    expect(offers.map((o) => o.sku).sort()).toEqual(
      ["BV-316L-DN50-FLG", "BV-316L-DN50-NPT"].sort(),
    );
  });

  it("writes prices as major-unit decimal strings, not minor units", () => {
    const npt = offers.find((o) => o.sku === "BV-316L-DN50-NPT")!;
    expect(npt.price).toBe("99.00");
    expect(npt.priceCurrency).toBe("USD");
  });

  it("marks a zero-stock SKU as out of stock", () => {
    const flanged = offers.find((o) => o.sku === "BV-316L-DN50-FLG")!;
    expect(flanged.availability).toBe("https://schema.org/OutOfStock");
  });

  it("marks a stocked SKU as in stock", () => {
    const npt = offers.find((o) => o.sku === "BV-316L-DN50-NPT")!;
    expect(npt.availability).toBe("https://schema.org/InStock");
  });

  it("expresses MOQ as the offer's minimum eligible quantity", () => {
    const npt = offers.find((o) => o.sku === "BV-316L-DN50-NPT")!;
    const eligible = npt.eligibleQuantity as Record<string, unknown>;
    expect(eligible.minValue).toBe(10);
    expect(eligible.unitCode).toBe("C62");
  });

  it("expresses the lead time as a shipping detail range in days", () => {
    const npt = offers.find((o) => o.sku === "BV-316L-DN50-NPT")!;
    const shipping = npt.shippingDetails as Record<string, unknown>;
    const transit = (shipping.deliveryTime as Record<string, unknown>)
      .transitTime as Record<string, unknown>;
    expect(transit.minValue).toBe(15);
    expect(transit.maxValue).toBe(20);
    expect(transit.unitCode).toBe("DAY");
  });

  it("omits offers for SKUs without a price rather than emitting a zero price", () => {
    const ldNoPrice = productJsonLd({
      ...base,
      variants: [{ ...variants[0], priceMinor: null, priceCurrency: null }],
    }) as Record<string, unknown>;

    expect(ldNoPrice.offers).toBeUndefined();
  });
});

describe("breadcrumbJsonLd", () => {
  const ld = breadcrumbJsonLd([
    { name: "Products", url: `${SITE.url}/en/products` },
    { name: "Ball Valve", url: `${SITE.url}/en/products/ball-valve` },
  ]) as Record<string, unknown>;

  it("numbers positions from 1 upwards", () => {
    const items = ld.itemListElement as Record<string, unknown>[];
    expect(items.map((i) => i.position)).toEqual([1, 2]);
  });

  it("keeps names and urls aligned with the input order", () => {
    const items = ld.itemListElement as Record<string, unknown>[];
    expect(items[0].name).toBe("Products");
    expect(items[1].item).toBe(`${SITE.url}/en/products/ball-valve`);
  });
});

describe("buildUseCaseJsonLd", () => {
  const ld = buildUseCaseJsonLd({
    headline: "Ball valves for offshore platform seawater lines",
    body: "Offshore seawater service combines chloride attack with vibration.",
    url: `${SITE.url}/en/products/ball-valve/offshore-seawater-lines`,
    productName: "Stainless Steel Ball Valve DN50",
    productUrl: `${SITE.url}/en/products/ball-valve`,
    locale: "en",
  }) as Record<string, unknown>;

  it("declares an Article carrying the scenario content", () => {
    expect(ld["@type"]).toBe("Article");
    expect(ld.headline).toBe(
      "Ball valves for offshore platform seawater lines",
    );
    expect(ld.inLanguage).toBe("en");
  });

  it("links the article back to the product it describes", () => {
    const about = ld.about as Record<string, unknown>;
    expect(about["@type"]).toBe("Product");
    expect(about.name).toBe("Stainless Steel Ball Valve DN50");
    expect(about.url).toBe(`${SITE.url}/en/products/ball-valve`);
  });

  it("points mainEntityOfPage at itself, not at the product page", () => {
    expect(ld.mainEntityOfPage).toBe(
      `${SITE.url}/en/products/ball-valve/offshore-seawater-lines`,
    );
  });
});
