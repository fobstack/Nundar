import { CURRENCY_MINOR_UNITS, type Currency } from "@/config/currency";
import type { Locale } from "@/config/locales";

function factorFor(currency: Currency): number {
  return 10 ** CURRENCY_MINOR_UNITS[currency];
}

/** 四舍五入且对 .5 一律远离零取整，避免 Math.round 对负数的偏向 */
function roundHalfAwayFromZero(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/**
 * 把带小数的金额转成最小货币单位整数。
 * 先乘再修正浮点误差：1.005 * 100 在 IEEE754 下是 100.49999999999999，
 * 直接 round 会得到 100，故先用 toFixed 收敛有效位。
 */
export function toMinor(amount: number, currency: Currency): number {
  if (!Number.isFinite(amount)) {
    throw new Error(`Amount must be a finite number, received: ${amount}`);
  }
  const digits = CURRENCY_MINOR_UNITS[currency];
  return roundHalfAwayFromZero(
    Number((amount * factorFor(currency)).toFixed(digits + 2)),
  );
}

export function fromMinor(minor: number, currency: Currency): number {
  if (!Number.isInteger(minor)) {
    throw new Error(`Minor amount must be an integer, received: ${minor}`);
  }
  return minor / factorFor(currency);
}

/** 最小单位整数乘以系数（汇率、缓冲），结果仍为整数 */
export function multiplyMinor(minor: number, factor: number): number {
  if (!Number.isInteger(minor)) {
    throw new Error(`Minor amount must be an integer, received: ${minor}`);
  }
  if (!Number.isFinite(factor)) {
    throw new Error(`Factor must be a finite number, received: ${factor}`);
  }
  return roundHalfAwayFromZero(minor * factor);
}

export function sumMinor(values: number[]): number {
  return values.reduce((total, value) => {
    if (!Number.isInteger(value)) {
      throw new Error(`Minor amount must be an integer, received: ${value}`);
    }
    return total + value;
  }, 0);
}

export function formatMoney(
  minor: number,
  currency: Currency,
  locale: Locale,
): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  }).format(fromMinor(minor, currency));
}
