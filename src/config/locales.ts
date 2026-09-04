import type { Currency } from "./currency";

export const LOCALES = ["en", "de", "fr", "es"] as const;

export type Locale = (typeof LOCALES)[number];

/** 默认语言，同时承担 hreflang 的 x-default */
export const DEFAULT_LOCALE: Locale = "en";

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/**
 * 语言的默认币种。用户可手动切换到任意受支持币种，选择存 cookie。
 * 绝不依据访问者 IP 自动切换——爬虫多从美国 IP 抓取，强制跳转会让其他语言版本无法被索引。
 */
const LOCALE_DEFAULT_CURRENCY: Record<Locale, Currency> = {
  en: "USD",
  de: "EUR",
  fr: "EUR",
  es: "EUR",
};

export function defaultCurrencyForLocale(locale: Locale): Currency {
  return LOCALE_DEFAULT_CURRENCY[locale];
}
