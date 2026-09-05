import { CURRENCY_MINOR_UNITS, type Currency } from "@/config/currency";
import type { Locale } from "@/config/locales";

function factorFor(currency: Currency): number {
  return 10 ** CURRENCY_MINOR_UNITS[currency];
}

/** Round half away from zero — Math.round biases negatives towards positive infinity */
function roundHalfAwayFromZero(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/**
 * Convert a decimal amount into an integer number of minor units.
 *
 * Multiply first, then settle the floating-point error: in IEEE 754,
 * 1.005 * 100 is 100.49999999999999, so rounding directly yields 100.
 * toFixed collapses the significant digits before rounding.
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

/** Multiply minor units by a factor (a rate, a buffer); the result stays an integer */
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
