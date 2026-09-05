export const CURRENCIES = ["USD", "EUR", "GBP"] as const;

export type Currency = (typeof CURRENCIES)[number];

/** The base currency: the only one priced by hand. The rest are derived from rates. */
export const BASE_CURRENCY: Currency = "USD";

/** Decimal places in each currency's minor unit, for converting between the stored
 * integer and what is displayed */
export const CURRENCY_MINOR_UNITS: Record<Currency, number> = {
  USD: 2,
  EUR: 2,
  GBP: 2,
};

export function isCurrency(value: string): value is Currency {
  return (CURRENCIES as readonly string[]).includes(value);
}

export const PRICING = {
  /** Buffer over the raw rate, covering rate movement and Stripe's cross-border fee */
  bufferRate: 0.03,
  /** Prices only move once the rate has drifted this far, so they do not twitch daily */
  recalcThreshold: 0.02,
  /** How a converted amount is rounded to a psychological price point */
  roundingStrategy: "ending99",
} as const;
