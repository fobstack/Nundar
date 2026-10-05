/**
 * Availability as a state.
 *
 * A page says "in stock" or "made to order", never how many are left: an
 * exact count would have to be purged from the edge cache on every sale,
 * while a state changes rarely. So what matters to a cached page is not that
 * stock moved, but whether it moved across the line between states.
 */

export type Availability = 'in_stock' | 'made_to_order' | 'out_of_stock';

/** The columns of `p_shop_variant` that decide a variant's availability. */
export interface StockRow {
  id: string;
  product_group: string;
  stock: number;
  moq: number;
  stock_policy: string;
}

/**
 * The state a variant is in.
 *
 * A tracked variant is in stock while one minimum order can still be filled.
 * Five left with a minimum order of ten is out of stock: nobody can buy it,
 * and `quantityIssue` in `cart-pricing.ts` would refuse them. The two must
 * agree, and `test/shop/availability.test.ts` holds them to it.
 */
export function availabilityOf(
  variant: Pick<StockRow, 'stock' | 'moq' | 'stock_policy'>,
): Availability {
  if (variant.stock_policy !== 'track') {
    return 'made_to_order';
  }
  return variant.stock >= variant.moq ? 'in_stock' : 'out_of_stock';
}

/**
 * The products whose availability differs between two readings of the same
 * variants — the products whose cached pages now say something untrue.
 */
export function changedProductGroups(
  before: readonly StockRow[],
  after: readonly StockRow[],
): string[] {
  const earlier = new Map(before.map((row) => [row.id, availabilityOf(row)]));
  const changed = new Set<string>();
  for (const row of after) {
    const was = earlier.get(row.id);
    if (was !== undefined && was !== availabilityOf(row)) {
      changed.add(row.product_group);
    }
  }
  return [...changed].sort();
}
