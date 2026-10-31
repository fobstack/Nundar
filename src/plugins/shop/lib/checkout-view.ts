/**
 * The checkout page as a theme draws it: what the layout `shop/checkout`
 * receives as `plugin_page`. As with the cart's view, every value is ready to
 * print and the words around it are the theme's.
 *
 *   currency       the currency every amount is in
 *   lines[]        sku, name, path, quantity, unit_price, line_total
 *   goods          what the lines come to
 *   countries[]    code, name, selected: where the cart can be shipped in its
 *                  currency, by name in the page's language
 *   country        the country chosen, or ''
 *   zone           the shipping zone's name; '' until a country is chosen
 *   shipping       what shipping costs, or ''; `shipping_free` when it is
 *                  nothing because the goods passed `free_over`
 *   free_over      what the goods must come to to ship free, or ''
 *   total          goods and shipping; '' until a country is chosen
 *   tax_mode       `none`: prices are without tax and none is charged.
 *                  `stripe`: tax is added at payment, where it applies
 *   problem        '' or why the cart cannot be checked out as it stands:
 *                  `empty`, `cart_problem`, `no_shipping`, `too_small`,
 *                  `too_large`
 *   payments       whether the shop can take a payment at all: false until
 *                  its Stripe keys are set
 *   can_place      the form can be sent: payments, a country, no problem
 *   refused        null, or `kind` and `field`: why the form that was sent
 *                  placed no order — `invalid` (with the field), `empty`,
 *                  `cart_problem`, `no_shipping`, `too_small`, `too_large`,
 *                  `payments_unavailable`; `paid_meanwhile` (an earlier
 *                  order from this cart is paid at Stripe and being
 *                  confirmed), `in_progress` (another checkout of this cart
 *                  is under way), `too_many` (the visitor's limit an hour)
 *   terms_path     a page the buyer must accept to order, or ''
 *   country_action where the form that chooses a country is sent, by GET
 *   action         where the order form posts
 *   cart_path      the cart page
 *   limits         the most each field may hold: `email`, `company`,
 *                  `recipient`, `phone`, `line1`, `line2`, `postal_code`,
 *                  `city`, `state`, `tax_id`
 *   email_pattern, name_pattern   the patterns the server holds the address
 *                  and every required line to, as a field's `pattern`
 *
 * The order form's fields are those of `limits`, then `country` (the one
 * chosen, as a hidden field), `terms` (a box sending `yes`, when there is a
 * `terms_path`) and `website`, which a person must not see. `email`,
 * `company`, `recipient`, `line1` and `city` are required.
 *
 * A form the server refuses comes back empty — Mallok lists a page under the
 * address that rendered it, so the refusal is a redirect to this page, and
 * what was typed does not travel in an address. The fields carry the
 * server's rules so that a browser refuses first.
 */

import { CHECKOUT_LIMITS, type CheckoutReading } from './checkout.js';
import { EMAIL_PATTERN_SOURCE, NAME_PATTERN_SOURCE } from './inquiries.js';
import { formatMoney } from './money.js';
import type { TaxMode } from './orders.js';

/** Why a sent form placed no order. A theme has words for each. */
export const CHECKOUT_REFUSALS = [
  'invalid',
  'empty',
  'cart_problem',
  'no_shipping',
  'too_small',
  'too_large',
  'payments_unavailable',
  'paid_meanwhile',
  'in_progress',
  'too_many',
] as const;

export type CheckoutRefusal = (typeof CHECKOUT_REFUSALS)[number];

export function checkoutView(
  reading: CheckoutReading,
  input: {
    readonly locale: string;
    readonly taxMode: TaxMode;
    readonly payments: boolean;
    readonly termsPath: string;
    readonly refused: { kind: CheckoutRefusal; field: string } | null;
    readonly paths: {
      readonly checkout: string;
      readonly place: string;
      readonly cart: string;
    };
  },
): Readonly<Record<string, unknown>> {
  const { facts, quote, rate } = reading;
  const money = (minor: number) =>
    formatMoney(minor, facts.currency, input.locale);
  const goodsMinor =
    quote?.goodsMinor ??
    facts.lines.reduce(
      (sum, line) => sum + (line.unitPriceMinor ?? 0) * line.quantity,
      0,
    );
  const priced =
    reading.problem !== 'empty' && reading.problem !== 'cart_problem';
  return {
    currency: facts.currency,
    lines: facts.lines.map((line) => ({
      sku: line.sku,
      name: line.name ?? '',
      path: line.path ?? '',
      quantity: line.quantity,
      unit_price:
        line.unitPriceMinor === null ? '' : money(line.unitPriceMinor),
      line_total:
        line.unitPriceMinor === null
          ? ''
          : money(line.unitPriceMinor * line.quantity),
    })),
    goods: priced ? money(goodsMinor) : '',
    countries: reading.countries.map((entry) => ({
      code: entry.code,
      name: entry.name,
      selected: entry.code === reading.country,
    })),
    country: reading.country ?? '',
    zone: rate?.zoneName ?? '',
    shipping: quote === null ? '' : money(quote.shippingMinor),
    shipping_free: quote !== null && quote.shippingMinor === 0,
    free_over:
      rate === null || rate.freeOverMinor === null
        ? ''
        : money(rate.freeOverMinor),
    total: quote === null ? '' : money(quote.totalMinor),
    tax_mode: input.taxMode,
    problem: reading.problem ?? '',
    payments: input.payments,
    can_place:
      input.payments && reading.problem === null && reading.country !== null,
    refused: input.refused,
    terms_path: input.termsPath,
    country_action: input.paths.checkout,
    action: input.paths.place,
    cart_path: input.paths.cart,
    limits: CHECKOUT_LIMITS,
    email_pattern: EMAIL_PATTERN_SOURCE,
    name_pattern: NAME_PATTERN_SOURCE,
  };
}
