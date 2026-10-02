/**
 * Money as integer minor units.
 *
 * Every amount the shop stores, adds or compares is an integer number of minor
 * units (cents). A float never represents money here: accumulated rounding
 * error is the classic way a commerce system ends up a cent out on an invoice.
 */

import { CURRENCY_MINOR_UNITS, type Currency } from './currency.js';

function factorFor(currency: Currency): number {
  return 10 ** CURRENCY_MINOR_UNITS[currency];
}

/** Rounds half away from zero. `Math.round` biases negatives towards +∞. */
function roundHalfAwayFromZero(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

function assertInteger(minor: number): void {
  if (!Number.isInteger(minor)) {
    throw new Error(`Minor amount must be an integer, received: ${minor}`);
  }
}

/**
 * Converts a decimal amount into minor units.
 *
 * Multiply first, then settle the floating-point error: in IEEE 754,
 * `1.005 * 100` is `100.49999999999999`, so rounding it directly yields 100.
 * `toFixed` collapses the significant digits before the rounding happens.
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
  assertInteger(minor);
  return minor / factorFor(currency);
}

/** Multiplies minor units by a factor (a rate, a buffer); stays an integer. */
export function multiplyMinor(minor: number, factor: number): number {
  assertInteger(minor);
  if (!Number.isFinite(factor)) {
    throw new Error(`Factor must be a finite number, received: ${factor}`);
  }
  return roundHalfAwayFromZero(minor * factor);
}

export function sumMinor(values: readonly number[]): number {
  let total = 0;
  for (const value of values) {
    assertInteger(value);
    total += value;
  }
  return total;
}

/** Formats minor units for display in a locale, for example `€91.99`. */
export function formatMoney(
  minor: number,
  currency: Currency,
  locale: string,
): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
  }).format(fromMinor(minor, currency));
}
