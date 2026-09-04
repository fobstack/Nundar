import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCALE,
  LOCALES,
  defaultCurrencyForLocale,
  isLocale,
} from "@/config/locales";
import {
  BASE_CURRENCY,
  CURRENCIES,
  CURRENCY_MINOR_UNITS,
  PRICING,
} from "@/config/currency";

describe("locales config", () => {
  it("ships exactly the four target-market locales", () => {
    expect([...LOCALES]).toEqual(["en", "de", "fr", "es"]);
  });

  it("defaults to English, which also carries x-default", () => {
    expect(DEFAULT_LOCALE).toBe("en");
  });

  it("narrows unknown strings", () => {
    expect(isLocale("de")).toBe(true);
    expect(isLocale("zh")).toBe(false);
  });

  it("maps each locale to a default currency", () => {
    expect(defaultCurrencyForLocale("en")).toBe("USD");
    expect(defaultCurrencyForLocale("de")).toBe("EUR");
    expect(defaultCurrencyForLocale("fr")).toBe("EUR");
    expect(defaultCurrencyForLocale("es")).toBe("EUR");
  });
});

describe("currency config", () => {
  it("ships USD as base plus EUR and GBP", () => {
    expect([...CURRENCIES]).toEqual(["USD", "EUR", "GBP"]);
    expect(BASE_CURRENCY).toBe("USD");
  });

  it("uses two minor-unit decimals for every shipped currency", () => {
    expect(CURRENCY_MINOR_UNITS).toEqual({ USD: 2, EUR: 2, GBP: 2 });
  });

  it("carries the pricing-engine defaults from the spec", () => {
    expect(PRICING.bufferRate).toBe(0.03);
    expect(PRICING.recalcThreshold).toBe(0.02);
    expect(PRICING.roundingStrategy).toBe("ending99");
  });
});
