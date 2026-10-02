import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clearShopTables, createVariant, db, ensureSite } from './helpers.js';

async function stockOf(variantId: string): Promise<number | null> {
  const row = await db()
    .prepare('SELECT stock FROM p_shop_variant WHERE id = ?')
    .bind(variantId)
    .first<{ stock: number }>();
  return row?.stock ?? null;
}

async function stateValue(key: string): Promise<string | null> {
  const row = await db()
    .prepare('SELECT value FROM p_shop_state WHERE key = ?')
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? null;
}

describe('the shop schema', () => {
  beforeAll(ensureSite);
  beforeEach(clearShopTables);

  it('is created by Mallok’s migrator on the first request', async () => {
    const { results } = await db()
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name LIKE 'p_shop_%' ORDER BY name`,
      )
      .all<{ name: string }>();
    expect(results.map((row) => row.name)).toEqual([
      'p_shop_cart',
      'p_shop_cart_line',
      'p_shop_price',
      'p_shop_rate',
      'p_shop_state',
      'p_shop_variant',
    ]);

    const applied = await db()
      .prepare("SELECT id FROM migration WHERE id LIKE 'plugin:shop:%'")
      .all<{ id: string }>();
    expect(applied.results.map((row) => row.id)).toEqual([
      'plugin:shop:0001_shop',
    ]);
  });

  it('stores no price on a cart line', async () => {
    // A cart holds variants and quantities only. A price column here would be
    // a place for a client-supplied amount to hide.
    const { results } = await db()
      .prepare("SELECT name FROM pragma_table_info('p_shop_cart_line')")
      .all<{ name: string }>();
    expect(results.map((row) => row.name).sort()).toEqual([
      'cart_id',
      'quantity',
      'variant_id',
    ]);
  });

  it('refuses negative stock, a zero MOQ and an unknown stock policy', async () => {
    await createVariant({ id: 'v-ok', productGroup: 'g' });

    await expect(
      db()
        .prepare("UPDATE p_shop_variant SET stock = -1 WHERE id = 'v-ok'")
        .run(),
    ).rejects.toThrow(/CHECK/i);
    await expect(
      db().prepare("UPDATE p_shop_variant SET moq = 0 WHERE id = 'v-ok'").run(),
    ).rejects.toThrow(/CHECK/i);
    await expect(
      db()
        .prepare(
          "UPDATE p_shop_variant SET stock_policy = 'whenever' WHERE id = 'v-ok'",
        )
        .run(),
    ).rejects.toThrow(/CHECK/i);
  });
});

/**
 * The property the payment design rests on.
 *
 * When a payment is confirmed, stock is decremented in the same D1 batch that
 * marks the order paid. A decrement that would oversell has to undo that whole
 * batch. These tests pin down which mechanism actually does that in workerd,
 * rather than trusting a reading of the documentation.
 */
describe('a D1 batch and the stock CHECK', () => {
  beforeAll(ensureSite);
  beforeEach(clearShopTables);

  it('rolls the whole batch back when a decrement would go negative', async () => {
    await createVariant({ id: 'v-low', productGroup: 'g', stock: 5 });

    await expect(
      db().batch([
        // Stands in for "mark the order paid": a write that must not survive.
        db().prepare(
          "INSERT INTO p_shop_state (key, value, updated_at) VALUES ('order-marker', 'paid', '2026-10-01T00:00:00.000Z')",
        ),
        db().prepare(
          "UPDATE p_shop_variant SET stock = stock - 10 WHERE id = 'v-low'",
        ),
      ]),
    ).rejects.toThrow(/CHECK/i);

    expect(await stockOf('v-low')).toBe(5);
    expect(await stateValue('order-marker')).toBeNull();
  });

  it('rolls back earlier decrements when a later line cannot be satisfied', async () => {
    await createVariant({ id: 'v-plenty', productGroup: 'g', stock: 100 });
    await createVariant({ id: 'v-scarce', productGroup: 'g', stock: 1 });

    await expect(
      db().batch([
        db().prepare(
          "UPDATE p_shop_variant SET stock = stock - 10 WHERE id = 'v-plenty'",
        ),
        db().prepare(
          "UPDATE p_shop_variant SET stock = stock - 10 WHERE id = 'v-scarce'",
        ),
      ]),
    ).rejects.toThrow(/CHECK/i);

    // No compensation loop is needed: the first decrement never happened.
    expect(await stockOf('v-plenty')).toBe(100);
    expect(await stockOf('v-scarce')).toBe(1);
  });

  it('commits the whole batch when every decrement fits', async () => {
    await createVariant({ id: 'v-a', productGroup: 'g', stock: 10 });

    await db().batch([
      db().prepare(
        "INSERT INTO p_shop_state (key, value, updated_at) VALUES ('order-marker', 'paid', '2026-10-01T00:00:00.000Z')",
      ),
      db().prepare(
        "UPDATE p_shop_variant SET stock = stock - 10 WHERE id = 'v-a'",
      ),
    ]);

    expect(await stockOf('v-a')).toBe(0);
    expect(await stateValue('order-marker')).toBe('paid');
  });

  it('does not roll back on a conditional UPDATE that matches no row', async () => {
    // Why the CHECK is used instead of `WHERE stock >= qty`: an UPDATE that
    // matches nothing is not an error, so the batch commits around it and the
    // order would be marked paid with nothing decremented.
    await createVariant({ id: 'v-low', productGroup: 'g', stock: 5 });

    await db().batch([
      db().prepare(
        "INSERT INTO p_shop_state (key, value, updated_at) VALUES ('order-marker', 'paid', '2026-10-01T00:00:00.000Z')",
      ),
      db().prepare(
        "UPDATE p_shop_variant SET stock = stock - 10 WHERE id = 'v-low' AND stock >= 10",
      ),
    ]);

    expect(await stockOf('v-low')).toBe(5);
    expect(await stateValue('order-marker')).toBe('paid');
  });
});
