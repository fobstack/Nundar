import { BASE_CURRENCY, isCurrency, type Currency } from "@/config/currency";

/**
 * 币种偏好存 cookie。
 *
 * 语言由 URL 前缀唯一决定，币种则与语言解耦——同一门语言的买家可能要看不同币种。
 * 绝不依据 IP 自动切换：爬虫多从美国 IP 抓取，自动改写会让其他版本无法被正确索引。
 */
export const CURRENCY_COOKIE = "kontor_currency";

export const CURRENCY_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** 从 cookie 字符串里解析币种偏好，非法值一律忽略 */
export function parseCurrencyCookie(
  raw: string | undefined | null,
  fallback: Currency = BASE_CURRENCY,
): Currency {
  if (!raw) {
    return fallback;
  }
  return isCurrency(raw) ? raw : fallback;
}

/** 浏览器端读取偏好；服务端渲染阶段返回 null 由调用方回落 */
export function readCurrencyCookieFromDocument(): Currency | null {
  if (typeof document === "undefined") {
    return null;
  }

  const match = document.cookie.match(
    new RegExp(`(?:^|; )${CURRENCY_COOKIE}=([^;]*)`),
  );
  const value = match ? decodeURIComponent(match[1]) : null;

  return value && isCurrency(value) ? value : null;
}
