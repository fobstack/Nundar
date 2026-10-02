/**
 * The pricing rules: how a base price becomes a price in another currency, and
 * when a converted price is allowed to move.
 */

import { CURRENCY_MINOR_UNITS, type Currency } from './currency.js';
import { multiplyMinor } from './money.js';

export const ROUNDING_STRATEGIES = ['ending99', 'integer'] as const;

export type RoundingStrategy = (typeof ROUNDING_STRATEGIES)[number];

export interface PricingRules {
  /** Added over the raw rate: rate movement plus cross-border payment fees. */
  readonly bufferRate: number;
  /** A price moves only once the rate has drifted further than this. */
  readonly recalcThreshold: number;
  /** How a converted amount is rounded up to a price point. */
  readonly rounding: RoundingStrategy;
}

export const DEFAULT_PRICING_RULES: PricingRules = {
  bufferRate: 0.03,
  recalcThreshold: 0.02,
  rounding: 'ending99',
};

function fraction(value: unknown, fallback: number): number {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 0.5
    ? value
    : fallback;
}

/**
 * Reads the pricing rules from the plugin's settings.
 *
 * A missing or out-of-range value falls back to the default rather than
 * throwing: these run inside the cron, and a mistyped setting must not stop
 * every price from being maintained.
 */
export function pricingRulesFromSettings(
  settings: Readonly<Record<string, unknown>>,
): PricingRules {
  const rounding = settings.rounding;
  return {
    bufferRate: fraction(
      settings.buffer_rate,
      DEFAULT_PRICING_RULES.bufferRate,
    ),
    recalcThreshold: fraction(
      settings.recalc_threshold,
      DEFAULT_PRICING_RULES.recalcThreshold,
    ),
    rounding:
      typeof rounding === 'string' &&
      (ROUNDING_STRATEGIES as readonly string[]).includes(rounding)
        ? (rounding as RoundingStrategy)
        : DEFAULT_PRICING_RULES.rounding,
  };
}

/**
 * Psychological rounding, always upwards — rounding down would eat into the
 * exchange buffer that was just applied.
 *
 * - `ending99`: the smallest amount >= the input that ends in .99
 * - `integer`: the smallest whole unit >= the input
 */
export function applyPsychologicalRounding(
  minor: number,
  strategy: RoundingStrategy,
  currency: Currency,
): number {
  if (!Number.isInteger(minor)) {
    throw new Error(`Minor amount must be an integer, received: ${minor}`);
  }
  const unit = 10 ** CURRENCY_MINOR_UNITS[currency];
  if (strategy === 'integer') {
    return Math.ceil(minor / unit) * unit;
  }
  const wholeUnits = Math.floor(minor / unit);
  const candidate = wholeUnits * unit + (unit - 1);
  return candidate >= minor ? candidate : (wholeUnits + 1) * unit + (unit - 1);
}

/** Base price to a target currency: rate, then buffer, then rounding. */
export function convertPrice(input: {
  readonly baseMinor: number;
  readonly rate: number;
  readonly currency: Currency;
  readonly rules: PricingRules;
}): number {
  const { baseMinor, rate, currency, rules } = input;
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(
      `Exchange rate must be a positive finite number, received: ${rate}`,
    );
  }
  const converted = multiplyMinor(baseMinor, rate);
  const buffered = multiplyMinor(converted, 1 + rules.bufferRate);
  return applyPsychologicalRounding(buffered, rules.rounding, currency);
}

/**
 * Decides whether a price should be recomputed at the current rate.
 *
 * Rates refresh daily, but a price moves only once the drift passes the
 * threshold. Otherwise every product page would be purged every day, the price
 * in the structured data would keep drifting from the price charged — which is
 * what triggers Google Merchant mismatch warnings — and a returning buyer
 * would watch the price twitch.
 */
export function needsRecalculation(input: {
  readonly rateUsed: number | null;
  readonly currentRate: number;
  readonly threshold: number;
}): boolean {
  const { rateUsed, currentRate, threshold } = input;
  // No rate was ever recorded: a new price, or missing history. Compute once.
  if (rateUsed === null || !(rateUsed > 0)) {
    return true;
  }
  return Math.abs(currentRate - rateUsed) / rateUsed > threshold;
}
