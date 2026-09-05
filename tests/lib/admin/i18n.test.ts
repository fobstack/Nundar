import { describe, expect, it } from "vitest";
import {
  ADMIN_LOCALES,
  DEFAULT_ADMIN_LOCALE,
  formatAdminDate,
  getAdminMessages,
  isAdminLocale,
  parseAdminLocale,
} from "@/lib/admin/i18n";
import { LOCALES } from "@/config/locales";

describe("admin locales", () => {
  it("ships English and Chinese only", () => {
    expect([...ADMIN_LOCALES]).toEqual(["en", "zh"]);
  });

  it("defaults to English, since anyone may deploy this", () => {
    // The shop is run by whoever forked the project, not by its author. A
    // default of anything but English strands most of them on first login.
    expect(DEFAULT_ADMIN_LOCALE).toBe("en");
  });

  it("lists English first, so the picker opens on it", () => {
    expect(ADMIN_LOCALES[0]).toBe("en");
  });

  it("is a different set from the storefront content languages", () => {
    // The admin language faces whoever runs the shop; the storefront languages
    // face buyers. Conflating them means adding a buyer language inexplicably
    // demands another admin translation
    expect([...ADMIN_LOCALES]).not.toEqual([...LOCALES]);
    expect((LOCALES as readonly string[]).includes("zh")).toBe(false);
  });
});

describe("parseAdminLocale", () => {
  it("accepts a supported locale", () => {
    expect(parseAdminLocale("en")).toBe("en");
    expect(parseAdminLocale("zh")).toBe("zh");
  });

  it("falls back for an unknown or missing value", () => {
    expect(parseAdminLocale("de")).toBe(DEFAULT_ADMIN_LOCALE);
    expect(parseAdminLocale(undefined)).toBe(DEFAULT_ADMIN_LOCALE);
    expect(parseAdminLocale(null)).toBe(DEFAULT_ADMIN_LOCALE);
    expect(parseAdminLocale("")).toBe(DEFAULT_ADMIN_LOCALE);
  });

  it("honours an explicit fallback", () => {
    expect(parseAdminLocale("nope", "en")).toBe("en");
  });

  it("narrows correctly", () => {
    expect(isAdminLocale("zh")).toBe(true);
    expect(isAdminLocale("fr")).toBe(false);
  });
});

describe("message catalogue", () => {
  /** Collect every leaf path recursively, to compare the two languages' shapes */
  function paths(value: unknown, prefix = ""): string[] {
    if (typeof value !== "object" || value === null) {
      return [prefix];
    }
    return Object.entries(value as Record<string, unknown>).flatMap(
      ([key, child]) => paths(child, prefix ? `${prefix}.${key}` : key),
    );
  }

  it("has identical structure across locales", () => {
    const zh = paths(getAdminMessages("zh")).sort();
    const en = paths(getAdminMessages("en")).sort();

    // A shape mismatch means one language is missing a string and the page renders
    // undefined
    expect(en).toEqual(zh);
  });

  it("has no empty strings", () => {
    for (const locale of ADMIN_LOCALES) {
      const messages = getAdminMessages(locale);
      for (const section of Object.values(messages)) {
        for (const [key, value] of Object.entries(section)) {
          expect(String(value).trim().length, `${locale}.${key} is empty`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("keeps the languages genuinely different, catching copy-paste", () => {
    const zh = getAdminMessages("zh");
    const en = getAdminMessages("en");

    // Compare only entries that must differ: terms like "SKU" are legitimately
    // identical in both languages
    expect(zh.nav.overview).not.toBe(en.nav.overview);
    expect(zh.orders.refund).not.toBe(en.orders.refund);
    expect(zh.settings.owner).not.toBe(en.settings.owner);
  });
});

describe("formatAdminDate", () => {
  const timestamp = 1_788_000_000; // around 2026-09-05

  it("formats in the admin's own locale conventions", () => {
    const zh = formatAdminDate(timestamp, "zh");
    const en = formatAdminDate(timestamp, "en");

    expect(zh.length).toBeGreaterThan(0);
    expect(en.length).toBeGreaterThan(0);
    // en-GB and zh-CN both use slashes but order the parts differently, so the
    // formatted strings must at least differ
    expect(zh).not.toBe(en);
  });

  it("uses the runtime's built-in Intl rather than a date library", () => {
    // Confirms the output really comes from Intl rather than a hand-rolled format
    const viaIntl = new Intl.DateTimeFormat("en-GB", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(timestamp * 1000));

    expect(formatAdminDate(timestamp, "en")).toBe(viaIntl);
  });
});
