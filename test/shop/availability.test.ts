import { describe, expect, it } from 'vitest';
import {
  availabilityOf,
  changedProductGroups,
  type StockRow,
} from '../../src/plugins/shop/lib/availability.js';
import { quantityIssue } from '../../src/plugins/shop/lib/cart-pricing.js';

function row(overrides: Partial<StockRow> = {}): StockRow {
  return {
    id: 'v1',
    product_group: 'group-a',
    stock: 100,
    moq: 10,
    stock_policy: 'track',
    ...overrides,
  };
}

describe('availabilityOf', () => {
  it('is in stock while at least one minimum order can be filled', () => {
    expect(availabilityOf(row({ stock: 10, moq: 10 }))).toBe('in_stock');
    expect(availabilityOf(row({ stock: 500, moq: 10 }))).toBe('in_stock');
  });

  it('is out of stock once a minimum order cannot be filled', () => {
    // Five left with a minimum order of ten cannot be bought, so saying "in
    // stock" would send the buyer to a cart that refuses them.
    expect(availabilityOf(row({ stock: 5, moq: 10 }))).toBe('out_of_stock');
    expect(availabilityOf(row({ stock: 0, moq: 1 }))).toBe('out_of_stock');
  });

  it('is made to order whatever the stock says', () => {
    expect(
      availabilityOf(row({ stock: 0, stock_policy: 'made_to_order' })),
    ).toBe('made_to_order');
    expect(
      availabilityOf(row({ stock: 999, stock_policy: 'made_to_order' })),
    ).toBe('made_to_order');
  });

  it('never disagrees with what the cart will accept', () => {
    // The page states availability; the cart enforces it. They are two
    // functions, so this pins them to one rule: a variant is out of stock
    // exactly when its own minimum order is refused for lack of stock.
    for (const stock_policy of ['track', 'made_to_order']) {
      for (const moq of [1, 2, 10, 50]) {
        for (const stock of [0, 1, 9, 10, 11, 49, 50, 51, 1000]) {
          const variant = {
            ...row({ stock, moq, stock_policy }),
            sku: 'SKU',
            status: 'active',
          };
          const refused =
            quantityIssue(variant, moq)?.kind === 'insufficient_stock';

          expect(
            availabilityOf(variant) === 'out_of_stock',
            `${stock_policy}, stock ${stock}, minimum order ${moq}`,
          ).toBe(refused);
        }
      }
    }
  });
});

describe('changedProductGroups', () => {
  it('is empty when every variant is as available as it was', () => {
    const before = [
      row({ id: 'v1', stock: 100 }),
      row({ id: 'v2', stock: 50 }),
    ];
    const after = [row({ id: 'v1', stock: 90 }), row({ id: 'v2', stock: 40 })];

    expect(changedProductGroups(before, after)).toEqual([]);
  });

  it('names the product whose variant crossed the line', () => {
    const before = [
      row({ id: 'v1', product_group: 'group-a', stock: 15 }),
      row({ id: 'v2', product_group: 'group-b', stock: 100 }),
    ];
    const after = [
      row({ id: 'v1', product_group: 'group-a', stock: 5 }),
      row({ id: 'v2', product_group: 'group-b', stock: 90 }),
    ];

    expect(changedProductGroups(before, after)).toEqual(['group-a']);
  });

  it('names a product once however many of its variants changed', () => {
    const before = [row({ id: 'v1', stock: 10 }), row({ id: 'v2', stock: 10 })];
    const after = [row({ id: 'v1', stock: 0 }), row({ id: 'v2', stock: 0 })];

    expect(changedProductGroups(before, after)).toEqual(['group-a']);
  });

  it('sees a product come back as well as go', () => {
    const before = [row({ stock: 0 })];
    const after = [row({ stock: 10 })];

    expect(changedProductGroups(before, after)).toEqual(['group-a']);
  });

  it('ignores a made-to-order variant, whose stock says nothing', () => {
    const before = [row({ stock: 10, stock_policy: 'made_to_order' })];
    const after = [row({ stock: 0, stock_policy: 'made_to_order' })];

    expect(changedProductGroups(before, after)).toEqual([]);
  });
});
