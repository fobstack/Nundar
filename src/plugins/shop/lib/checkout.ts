/**
 * Checkout: what a cart comes to once it is going somewhere, and the form a
 * buyer fills in to send it.
 *
 * The checkout page and the order it places read the cart the same way —
 * `readCartFacts`, the cart page's own reading — and add one thing to it:
 * where the goods go, and so what shipping costs. `readCheckout` is that one
 * reading and `quoteOf` the one sum, so that the page cannot show a figure
 * the order would not charge.
 *
 * The shop sells to businesses (design §20, D1): a company is required. A
 * tax number is optional and recorded (D7). Only a country in a shipping
 * zone with a rate in the cart's currency can be shipped to (D5).
 */

import { z } from 'zod';
import type { CartLine } from './cart.js';
import { type CartFacts, readCartFacts } from './cart-pricing.js';
import type { Currency } from './currency.js';
import { EMAIL_PATTERN, INQUIRY_LIMITS, oneLine } from './inquiries.js';
import { sumMinor } from './money.js';
import type { TaxMode } from './orders.js';
import {
  countryName,
  isCountryCode,
  rateOf,
  type ShippingCountry,
  type ShippingRate,
  shippingCostMinor,
  shippingCountriesOf,
  shippingCountriesStatement,
} from './shipping.js';
import { MAX_CHARGE_MINOR, MIN_CHARGE_MINOR } from './stripe-client.js';

/** The length each field may have. The form carries the same in `maxlength`. */
export const CHECKOUT_LIMITS = {
  email: INQUIRY_LIMITS.email,
  company: 200,
  recipient: 200,
  phone: 60,
  line1: 200,
  line2: 200,
  city: 100,
  state: 100,
  postal_code: 20,
  tax_id: 40,
} as const;

/** The fields a buyer fills in, in the order a page shows them. */
export const CHECKOUT_FIELDS = [
  'email',
  'company',
  'recipient',
  'phone',
  'line1',
  'line2',
  'postal_code',
  'city',
  'state',
  'country',
  'tax_id',
  'terms',
] as const;

export type CheckoutField = (typeof CHECKOUT_FIELDS)[number];

/** What a box that is ticked sends. */
export const TERMS_ACCEPTED = 'yes';

export const checkoutFormSchema = z.object({
  email: z
    .string()
    .default('')
    .transform((value) => value.trim())
    .pipe(z.string().min(3).max(CHECKOUT_LIMITS.email).regex(EMAIL_PATTERN)),
  company: oneLine(CHECKOUT_LIMITS.company, 1),
  recipient: oneLine(CHECKOUT_LIMITS.recipient, 1),
  phone: oneLine(CHECKOUT_LIMITS.phone),
  line1: oneLine(CHECKOUT_LIMITS.line1, 1),
  line2: oneLine(CHECKOUT_LIMITS.line2),
  // Not every country has postal codes.
  postal_code: oneLine(CHECKOUT_LIMITS.postal_code),
  city: oneLine(CHECKOUT_LIMITS.city, 1),
  state: oneLine(CHECKOUT_LIMITS.state),
  country: z
    .string()
    .default('')
    .refine((value) => isCountryCode(value)),
  tax_id: oneLine(CHECKOUT_LIMITS.tax_id),
  terms: z.string().max(10).default(''),
  /** A field no person sees. Whatever fills it in is not one. */
  website: z.string().max(500).default(''),
});

export type CheckoutForm = z.infer<typeof checkoutFormSchema>;

/** The first field, in the page's order, that was refused. */
export function firstInvalidCheckoutField(
  error: z.ZodError,
): CheckoutField | null {
  const named = new Set(error.issues.map((issue) => issue.path[0]));
  return CHECKOUT_FIELDS.find((field) => named.has(field)) ?? null;
}

/** Why a cart cannot be checked out as it stands. A theme has words for each. */
export type CheckoutProblem =
  /** Nothing in it. */
  | 'empty'
  /** A line cannot be ordered: the cart page says which. */
  | 'cart_problem'
  /** No country chosen yet, or one the shop does not ship to in this currency. */
  | 'no_shipping'
  /** Less than Stripe charges: a total of nothing included (D14). */
  | 'too_small'
  /** More than one payment can carry. */
  | 'too_large';

export interface CheckoutQuote {
  readonly goodsMinor: number;
  readonly shippingMinor: number;
  readonly totalMinor: number;
}

/**
 * What a cart comes to, shipped at a rate, or why it cannot be checked out.
 * The one sum both the page and the order use.
 */
export function quoteOf(
  facts: CartFacts,
  rate: ShippingRate | null,
): { quote: CheckoutQuote | null; problem: CheckoutProblem | null } {
  if (facts.lines.length === 0) {
    return { quote: null, problem: 'empty' };
  }
  if (facts.lines.some((line) => line.issue !== null)) {
    return { quote: null, problem: 'cart_problem' };
  }
  const goodsMinor = sumMinor(
    facts.lines.map((line) => (line.unitPriceMinor ?? 0) * line.quantity),
  );
  if (rate === null || rate.currency !== facts.currency) {
    return { quote: null, problem: 'no_shipping' };
  }
  const shippingMinor = shippingCostMinor(rate, goodsMinor);
  const quote = {
    goodsMinor,
    shippingMinor,
    totalMinor: sumMinor([goodsMinor, shippingMinor]),
  };
  if (quote.totalMinor < MIN_CHARGE_MINOR[facts.currency]) {
    return { quote, problem: 'too_small' };
  }
  if (quote.totalMinor > MAX_CHARGE_MINOR) {
    return { quote, problem: 'too_large' };
  }
  return { quote, problem: null };
}

export interface CheckoutReading {
  readonly facts: CartFacts;
  /** The countries the cart can be shipped to in its currency, by name. */
  readonly countries: readonly { code: string; name: string }[];
  /** The country it is going to: one of `countries`, or null. */
  readonly country: string | null;
  readonly rate: ShippingRate | null;
  readonly quote: CheckoutQuote | null;
  readonly problem: CheckoutProblem | null;
}

/** Every rate a country has, whatever the currency: one zone's, or none. */
function countryRatesStatement(
  db: D1Database,
  country: string,
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT z.id AS zone_id, z.name AS zone_name, r.currency AS currency,
              r.amount_minor AS amount_minor,
              r.free_over_minor AS free_over_minor
       FROM p_shop_shipping_country AS c
       JOIN p_shop_shipping_zone AS z ON z.id = c.zone_id
       JOIN p_shop_shipping_rate AS r ON r.zone_id = z.id
       WHERE c.country = ?`,
    )
    .bind(country);
}

/**
 * Reads a cart for checking out to a country: the cart's own reading, then
 * where it can go and what that costs, in one more round trip.
 *
 * `country` is what the buyer asked for; it counts only when the cart can be
 * shipped there in its currency, and the reading says so by naming it.
 */
export async function readCheckout(
  db: D1Database,
  input: {
    readonly lines: readonly CartLine[];
    readonly locale: string;
    readonly defaultLocale: string;
    readonly currency: Currency;
    readonly country: string | null;
    readonly now?: Date;
  },
): Promise<CheckoutReading> {
  const facts = await readCartFacts(db, input);
  const asked =
    input.country !== null && isCountryCode(input.country) ? input.country : '';
  const [countryResult, rateResult] = await db.batch<Record<string, unknown>>([
    shippingCountriesStatement(db),
    countryRatesStatement(db, asked),
  ]);
  const shippable: ShippingCountry[] = shippingCountriesOf(
    countryResult?.results ?? [],
  ).filter((entry) => entry.currencies.includes(facts.currency));
  const countries = shippable
    .map((entry) => ({
      code: entry.code,
      name: countryName(entry.code, input.locale),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, input.locale));

  const rate =
    (rateResult?.results ?? [])
      .map(rateOf)
      .find((candidate) => candidate?.currency === facts.currency) ?? null;
  const country =
    rate !== null && countries.some((entry) => entry.code === asked)
      ? asked
      : null;
  const { quote, problem } = quoteOf(facts, country === null ? null : rate);
  return {
    facts,
    countries,
    country,
    rate: country === null ? null : rate,
    quote,
    problem,
  };
}

/** What the shop needs of Stripe to take a payment: both keys. */
export function stripeKeys(
  secrets: Readonly<Record<string, string>>,
): { secretKey: string; webhookSecret: string } | null {
  const secretKey = secrets.stripe_secret_key ?? '';
  const webhookSecret = secrets.stripe_webhook_secret ?? '';
  // Without the signing secret no payment could ever be confirmed: an order
  // would be paid for and wait for ever.
  return secretKey === '' || webhookSecret === ''
    ? null
    : { secretKey, webhookSecret };
}

export function taxModeOf(
  settings: Readonly<Record<string, unknown>>,
): TaxMode {
  return settings.tax_mode === 'stripe' ? 'stripe' : 'none';
}

/**
 * The page a buyer must accept, from the settings: a path on this site, or
 * nothing. Anything else is not printed as a link.
 */
export function termsPathOf(
  settings: Readonly<Record<string, unknown>>,
): string {
  const value =
    typeof settings.terms_path === 'string' ? settings.terms_path.trim() : '';
  return /^\/(?![/\\])[^\s\\]{0,200}$/.test(value) ? value : '';
}
