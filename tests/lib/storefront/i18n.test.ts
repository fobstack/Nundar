import { describe, expect, it } from "vitest";
import { LOCALES } from "@/config/locales";
import { getStorefrontMessages } from "@/lib/storefront/i18n";

/** Every leaf path, so two languages can be compared by shape. */
function paths(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) {
    return [prefix];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    paths(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe("storefront catalogue", () => {
  it("covers every storefront language", () => {
    for (const locale of LOCALES) {
      expect(getStorefrontMessages(locale), `${locale} is missing`).toBeDefined();
    }
  });

  it("has identical structure in every language", () => {
    const reference = paths(getStorefrontMessages("en")).sort();

    for (const locale of LOCALES) {
      expect(paths(getStorefrontMessages(locale)).sort(), `${locale} drifted`).toEqual(
        reference,
      );
    }
  });

  it("has no empty strings", () => {
    for (const locale of LOCALES) {
      const messages = getStorefrontMessages(locale);
      for (const [section, entries] of Object.entries(messages)) {
        for (const [key, value] of Object.entries(entries)) {
          expect(
            String(value).trim().length,
            `${locale}.${section}.${key} is empty`,
          ).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe("breadcrumb label", () => {
  /**
   * The breadcrumb is the reason this catalogue exists. It used to read
   * `locale === "de" ? "Produkte" : "Products"` in the theme, so French and
   * Spanish visitors saw an English breadcrumb — and the route layer emitted a
   * hardcoded English "Products" into every language's `BreadcrumbList`
   * structured data, which is what Google read.
   */
  it("is genuinely translated in every language", () => {
    const labels = LOCALES.map((locale) => getStorefrontMessages(locale).nav.products);

    expect(labels).toEqual(["Products", "Produkte", "Produits", "Productos"]);
  });

  it("differs from English wherever the language differs", () => {
    for (const locale of LOCALES) {
      if (locale === "en") continue;
      expect(
        getStorefrontMessages(locale).nav.products,
        `${locale} still shows the English breadcrumb`,
      ).not.toBe("Products");
    }
  });
});

describe("commerce vocabulary", () => {
  it("translates the terms a buyer needs to read correctly", () => {
    // Getting any of these wrong is a bug rather than a style choice, which is
    // exactly why they live here instead of inside a theme.
    for (const key of ["minimumOrder", "leadTime", "priceOnRequest", "outOfStock"] as const) {
      const values = LOCALES.map((locale) => getStorefrontMessages(locale).product[key]);
      expect(new Set(values).size, `${key} is not translated`).toBeGreaterThan(1);
    }
  });

  it("keeps language endonyms identical across languages", () => {
    // "Deutsch" is Deutsch in every language; a switcher that translates these
    // is unusable for the very reader who needs it.
    for (const locale of LOCALES) {
      expect(getStorefrontMessages(locale).language).toEqual({
        en: "English",
        de: "Deutsch",
        fr: "Français",
        es: "Español",
      });
    }
  });
});

describe("the transactional path", () => {
  /**
   * The storefront was fully multilingual in its SEO content and entirely
   * English from add-to-cart onwards: a French buyer read French application
   * notes, then met "Add to cart", "Your cart is empty" and "Subtotal" in
   * English at the moment they were about to pay.
   */
  const CONVERSION_CRITICAL = [
    ["addToCart", "add"],
    ["cart", "empty"],
    ["cart", "subtotal"],
    ["cart", "remove"],
    ["checkout", "continueToPayment"],
    ["checkout", "total"],
    ["orderStatus", "pending"],
    ["orderStatus", "oversold"],
  ] as const;

  it.each(CONVERSION_CRITICAL)("translates %s.%s in every language", (section, key) => {
    const values = LOCALES.map(
      (locale) =>
        (getStorefrontMessages(locale)[section] as Record<string, string>)[key],
    );

    for (const value of values) {
      expect(value.trim().length).toBeGreaterThan(0);
    }
    // Four languages must not all say the same thing here
    expect(new Set(values).size).toBeGreaterThan(1);
  });

  it("keeps the quantity placeholder in every translation", () => {
    // A translation that drops {n} silently renders "Minimum order quantity is ."
    for (const locale of LOCALES) {
      const t = getStorefrontMessages(locale);
      expect(t.cart.belowMoq, `${locale}.cart.belowMoq lost {n}`).toContain("{n}");
      expect(
        t.cart.insufficientStock,
        `${locale}.cart.insufficientStock lost {n}`,
      ).toContain("{n}");
    }
  });

  it("covers every order status the state machine can reach", () => {
    // A status with no message renders undefined on the page a buyer lands on
    // straight after paying.
    const statuses = [
      "pending",
      "paid",
      "shipped",
      "delivered",
      "cancelled",
      "refunded",
      "oversold",
    ] as const;

    for (const locale of LOCALES) {
      const messages = getStorefrontMessages(locale).orderStatus;
      for (const status of statuses) {
        expect(messages[status], `${locale} is missing ${status}`).toBeTruthy();
      }
    }
  });
});
