/**
 * The cart as a page shows it.
 *
 * This is the other half of the contract with a theme: what the layout
 * `shop/cart` receives as `plugin_page`. Like `plugins.shop`, every value is
 * ready to print and the words around it are the theme's.
 *
 *   currency      the currency every amount is in
 *   currencies    the currencies the cart could be shown in
 *   empty         nothing in it
 *   orderable     every line can be ordered as it stands
 *   subtotal      the sum of the lines; '' unless the cart is orderable
 *   lines[]       variant_id, sku, name, path, quantity, moq, unit_price,
 *                 line_total, problem, available
 *
 * A line's `problem` is '' or the reason it cannot be ordered: `unavailable`,
 * `below_moq`, `insufficient_stock`, `no_price`. A theme prints its own
 * words for each. `available` is how many can be had when the reason is
 * stock, and null otherwise.
 *
 * The route adds where its forms post (`action`), the cart's own address
 * (`cart_path`) and, after a change that was refused, what was refused
 * (`problem`).
 */

import type { CartFacts, CartIssue } from './cart-pricing.js';
import type { Currency } from './currency.js';
import { formatMoney, sumMinor } from './money.js';

export interface CartLineView {
  readonly variant_id: string;
  readonly sku: string;
  /** The product's name; '' when it can no longer be bought. */
  readonly name: string;
  /** Its page, in the cart's language where it has one; '' with the name. */
  readonly path: string;
  readonly quantity: number;
  readonly moq: number;
  /** '' when the line has no price in the cart's currency. */
  readonly unit_price: string;
  readonly line_total: string;
  readonly problem: '' | Exclude<CartIssue['kind'], 'empty'>;
  readonly available: number | null;
}

export interface CartView {
  readonly currency: Currency;
  readonly currencies: readonly Currency[];
  readonly empty: boolean;
  readonly orderable: boolean;
  readonly subtotal: string;
  readonly lines: readonly CartLineView[];
}

export function cartView(facts: CartFacts, locale: string): CartView {
  const { currency } = facts;
  const lines = facts.lines.map((line): CartLineView => {
    const { issue, unitPriceMinor } = line;
    return {
      variant_id: line.variantId,
      sku: line.sku,
      name: line.name ?? '',
      path: line.path ?? '',
      quantity: line.quantity,
      moq: line.moq,
      unit_price:
        unitPriceMinor === null
          ? ''
          : formatMoney(unitPriceMinor, currency, locale),
      line_total:
        unitPriceMinor === null
          ? ''
          : formatMoney(unitPriceMinor * line.quantity, currency, locale),
      problem: issue === null || issue.kind === 'empty' ? '' : issue.kind,
      available: issue?.kind === 'insufficient_stock' ? issue.available : null,
    };
  });
  const orderable =
    lines.length > 0 && facts.lines.every((line) => line.issue === null);

  return {
    currency,
    currencies: facts.currencies,
    empty: lines.length === 0,
    orderable,
    // A total over lines that cannot all be ordered would be a figure nobody
    // can pay: it is stated only when the cart can go through as it stands.
    subtotal: orderable
      ? formatMoney(
          sumMinor(
            facts.lines.map(
              (line) => (line.unitPriceMinor ?? 0) * line.quantity,
            ),
          ),
          currency,
          locale,
        )
      : '',
    lines,
  };
}
