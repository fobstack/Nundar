import { PRICING } from "@/config/currency";
import { multiplyMinor } from "@/lib/money";

export type RoundingStrategy = "ending99" | "integer";

/**
 * Psychological rounding, always upwards — rounding down would eat into the
 * exchange buffer that was just applied.
 *
 * ending99: the smallest amount >= the input that ends in 99 minor units
 * integer:  the smallest whole unit >= the input
 */
export function applyPsychologicalRounding(
  minor: number,
  strategy: RoundingStrategy,
): number {
  if (!Number.isInteger(minor)) {
    throw new Error(`Minor amount must be an integer, received: ${minor}`);
  }
  const unit = 100;
  if (strategy === "integer") {
    return Math.ceil(minor / unit) * unit;
  }
  const wholeUnits = Math.floor(minor / unit);
  const candidate = wholeUnits * unit + 99;
  return candidate >= minor ? candidate : (wholeUnits + 1) * unit + 99;
}

/** Base price to target currency: rate, then buffer, then psychological rounding */
export function convertPrice(input: {
  baseMinor: number;
  rate: number;
  bufferRate?: number;
  strategy?: RoundingStrategy;
}): number {
  const { baseMinor, rate } = input;
  const bufferRate = input.bufferRate ?? PRICING.bufferRate;
  const strategy = input.strategy ?? PRICING.roundingStrategy;

  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(
      `Exchange rate must be a positive finite number, received: ${rate}`,
    );
  }

  const converted = multiplyMinor(baseMinor, rate);
  const buffered = multiplyMinor(converted, 1 + bufferRate);
  return applyPsychologicalRounding(buffered, strategy);
}

/**
 * Decide whether a price should be recomputed at the current rate.
 *
 * Rates refresh daily, but prices only move once the drift passes a threshold.
 * Otherwise every static page would regenerate every day, and the price in the
 * JSON-LD would keep drifting away from the settled price, which is what
 * triggers Google Merchant mismatch warnings.
 */
export function needsRecalculation(input: {
  rateUsed: number;
  currentRate: number;
  threshold?: number;
}): boolean {
  const { rateUsed, currentRate } = input;
  const threshold = input.threshold ?? PRICING.recalcThreshold;

  // No rate was ever recorded — a new price, or missing history. Compute once.
  if (!rateUsed || rateUsed <= 0) {
    return true;
  }

  const drift = Math.abs(currentRate - rateUsed) / rateUsed;
  return drift > threshold;
}
