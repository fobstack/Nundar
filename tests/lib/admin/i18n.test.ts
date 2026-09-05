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
  it("ships Chinese and English only", () => {
    expect([...ADMIN_LOCALES]).toEqual(["zh", "en"]);
  });

  it("defaults to Chinese, the operator's language", () => {
    expect(DEFAULT_ADMIN_LOCALE).toBe("zh");
  });

  it("is a different set from the storefront content languages", () => {
    // 后台界面语言面向运营，前台内容语言面向买家。混用会导致
    // 加一门买家语言就莫名其妙要求补一份后台翻译
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
  /** 递归收集所有叶子路径，用来比对两种语言的结构 */
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

    // 结构不一致意味着某一门语言漏了文案，页面会显示 undefined
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

  it("keeps Chinese and English genuinely different, catching copy-paste", () => {
    const zh = getAdminMessages("zh");
    const en = getAdminMessages("en");

    // 只比对确定该不同的条目：像 "SKU" 这类术语两语言相同是正常的
    expect(zh.nav.overview).not.toBe(en.nav.overview);
    expect(zh.orders.refund).not.toBe(en.orders.refund);
    expect(zh.settings.owner).not.toBe(en.settings.owner);
  });
});

describe("formatAdminDate", () => {
  const timestamp = 1_788_000_000; // 2026-09-05 前后

  it("formats in the admin's own locale conventions", () => {
    const zh = formatAdminDate(timestamp, "zh");
    const en = formatAdminDate(timestamp, "en");

    expect(zh.length).toBeGreaterThan(0);
    expect(en.length).toBeGreaterThan(0);
    // en-GB 用斜杠分隔日期，zh-CN 用斜杠但顺序不同——至少格式串应有差异
    expect(zh).not.toBe(en);
  });

  it("uses the runtime's built-in Intl rather than a date library", () => {
    // 有日期库时这个断言无意义；这里确认输出确实来自 Intl
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
