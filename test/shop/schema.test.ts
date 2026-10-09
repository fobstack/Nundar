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
      'p_shop_inquiry',
      'p_shop_inquiry_line',
      'p_shop_order',
      'p_shop_order_line',
      'p_shop_outbox',
      'p_shop_price',
      'p_shop_rate',
      'p_shop_state',
      'p_shop_stock_adjustment',
      'p_shop_stripe_event',
      'p_shop_variant',
    ]);

    const applied = await db()
      .prepare(
        "SELECT id FROM migration WHERE id LIKE 'plugin:shop:%' ORDER BY id",
      )
      .all<{ id: string }>();
    expect(applied.results.map((row) => row.id)).toEqual([
      'plugin:shop:0001_shop',
      'plugin:shop:0002_orders',
      'plugin:shop:0003_inquiries',
    ]);
  });

  it('refuses a fractional price, stock, minimum order or cart quantity', async () => {
    // SQLite would keep each of these in its INTEGER column as a real number.
    // The column's own type check is what refuses them.
    await createVariant({ id: 'v-types', productGroup: 'g' });
    const now = '2026-10-01T00:00:00.000Z';

    await expect(
      db()
        .prepare("UPDATE p_shop_variant SET stock = 5.5 WHERE id = 'v-types'")
        .run(),
    ).rejects.toThrow(/CHECK/i);
    await expect(
      db()
        .prepare("UPDATE p_shop_variant SET moq = 1.5 WHERE id = 'v-types'")
        .run(),
    ).rejects.toThrow(/CHECK/i);
    await expect(
      db()
        .prepare(
          `INSERT INTO p_shop_price
             (variant_id, currency, amount_minor, source, updated_at)
           VALUES ('v-types', 'USD', 99.5, 'base', ?)`,
        )
        .bind(now)
        .run(),
    ).rejects.toThrow(/CHECK/i);
    await expect(
      db()
        .prepare(
          `INSERT INTO p_shop_cart_line (cart_id, variant_id, quantity)
           VALUES ('c-types', 'v-types', 2.5)`,
        )
        .run(),
    ).rejects.toThrow(/CHECK/i);

    // A whole number written as text, the way a form field arrives, is
    // converted by the column and accepted.
    await db()
      .prepare("UPDATE p_shop_variant SET stock = '7' WHERE id = 'v-types'")
      .run();
    const row = await db()
      .prepare(
        "SELECT stock, typeof(stock) AS kind FROM p_shop_variant WHERE id = 'v-types'",
      )
      .first<{ stock: number; kind: string }>();
    expect(row).toEqual({ stock: 7, kind: 'integer' });
  });

  it('stores no card data and no price a client could have sent on an order', async () => {
    // What an order may hold is listed here on purpose: a new column has to
    // be added to this list by someone who has thought about what it stores.
    const columns = async (table: string): Promise<string[]> => {
      const { results } = await db()
        .prepare(`SELECT name FROM pragma_table_info('${table}')`)
        .all<{ name: string }>();
      return results.map((row) => row.name).sort();
    };

    expect(await columns('p_shop_order')).toEqual([
      'created_at',
      'currency',
      'email',
      'id',
      'locale',
      'order_no',
      'shipping_address',
      'shipping_minor',
      'status',
      'stripe_payment_intent_id',
      'stripe_session_id',
      'subtotal_minor',
      'tax_minor',
      'total_minor',
      'tracking_no',
      'updated_at',
    ]);
    expect(await columns('p_shop_order_line')).toEqual([
      'id',
      'name_snapshot',
      'order_id',
      'quantity',
      'sku_snapshot',
      'unit_price_minor',
      'variant_id',
    ]);
  });

  it('lets one payment belong to one order only', async () => {
    const order = (id: string, paymentIntent: string | null) =>
      db()
        .prepare(
          `INSERT INTO p_shop_order
             (id, order_no, status, currency, subtotal_minor, total_minor,
              stripe_payment_intent_id, email, shipping_address, locale,
              created_at, updated_at)
           VALUES (?, ?, 'pending', 'USD', 100, 100, ?, 'a@example.com', '{}',
                   'en', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`,
        )
        .bind(id, `ND-${id}`, paymentIntent)
        .run();

    // Any number of orders may be waiting for a payment…
    await order('o1', null);
    await order('o2', null);
    // …but a payment that settled one order cannot settle another.
    await order('o3', 'pi_1');
    await expect(order('o4', 'pi_1')).rejects.toThrow(/UNIQUE/i);
  });

  it('holds one line per variant on an order', async () => {
    // The payment write reads a line's quantity by order and variant and
    // relies on finding exactly one.
    const line = (id: string) =>
      db()
        .prepare(
          `INSERT INTO p_shop_order_line
             (id, order_id, variant_id, sku_snapshot, name_snapshot,
              unit_price_minor, quantity)
           VALUES (?, 'o1', 'v1', 'SKU', 'Name', 100, 1)`,
        )
        .bind(id)
        .run();

    await line('first');
    await expect(line('second')).rejects.toThrow(/UNIQUE/i);
  });

  it('refuses order money that is not a whole number of minor units', async () => {
    // SQLite keeps 99.5 in an INTEGER column as a real number rather than
    // refuse it. Each money column checks its own storage type instead.
    const line = (unitPrice: number, quantity: number) =>
      db()
        .prepare(
          `INSERT INTO p_shop_order_line
             (id, order_id, variant_id, sku_snapshot, name_snapshot,
              unit_price_minor, quantity)
           VALUES ('l-' || ? || '-' || ?, 'o-types', 'v-' || ? || '-' || ?,
                   'SKU', 'Name', ?, ?)`,
        )
        .bind(unitPrice, quantity, unitPrice, quantity, unitPrice, quantity)
        .run();
    const order = (subtotal: number, shipping: number) =>
      db()
        .prepare(
          `INSERT INTO p_shop_order
             (id, order_no, currency, subtotal_minor, shipping_minor,
              total_minor, email, shipping_address, locale, created_at,
              updated_at)
           VALUES ('o-' || ? || '-' || ?, 'ND-' || ? || '-' || ?, 'USD', ?, ?,
                   ?, 'a@example.com', '{}', 'en',
                   '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`,
        )
        .bind(
          subtotal,
          shipping,
          subtotal,
          shipping,
          subtotal,
          shipping,
          subtotal + shipping,
        )
        .run();

    await line(9900, 10);
    await expect(line(99.5, 10)).rejects.toThrow(/CHECK/i);
    await expect(line(9900, 1.5)).rejects.toThrow(/CHECK/i);

    await order(9900, 500);
    await expect(order(99.5, 0)).rejects.toThrow(/CHECK/i);
    await expect(order(9900, 0.5)).rejects.toThrow(/CHECK/i);
    // Two halves that add up to a whole total: only the parts' own checks
    // can refuse this one.
    await expect(order(99.5, 0.5)).rejects.toThrow(/CHECK/i);

    await expect(
      db()
        .prepare(
          `INSERT INTO p_shop_stock_adjustment
             (id, variant_id, delta, reason, created_at)
           VALUES ('half', 'v1', -1.5, 'manual', '2026-10-01T00:00:00.000Z')`,
        )
        .run(),
    ).rejects.toThrow(/CHECK/i);
  });

  it('acts on one payment once, whatever id its event carries', async () => {
    // Stripe can send two events about one object. The record is unique on
    // the event's type and the payment, so the second cannot be written.
    const event = (eventId: string, type: string, paymentIntent: string) =>
      db()
        .prepare(
          `INSERT INTO p_shop_stripe_event
             (event_id, type, order_id, payment_intent_id, outcome,
              processed_at)
           VALUES (?, ?, 'o1', ?, 'paid', '2026-10-01T00:00:00.000Z')`,
        )
        .bind(eventId, type, paymentIntent)
        .run();

    await event('evt_1', 'payment_intent.succeeded', 'pi_1');
    await expect(
      event('evt_2', 'payment_intent.succeeded', 'pi_1'),
    ).rejects.toThrow(/UNIQUE/i);
    await expect(
      event('evt_1', 'payment_intent.succeeded', 'pi_2'),
    ).rejects.toThrow(/UNIQUE|PRIMARY/i);
    // A different kind of event about the same payment is a different fact.
    await event('evt_3', 'charge.refunded', 'pi_1');
  });

  it('holds one outbox row per change, so a duty cannot be written twice', async () => {
    const row = () =>
      db()
        .prepare(
          `INSERT INTO p_shop_outbox (id, topic, order_id, created_at)
           VALUES ('order.paid:o1', 'order.paid', 'o1',
                   '2026-10-01T00:00:00.000Z')`,
        )
        .run();

    await row();
    await expect(row()).rejects.toThrow(/UNIQUE|PRIMARY/i);
  });

  it('records one stock movement per order, variant and reason', async () => {
    // The ledger row's id is built from what it records, so writing the same
    // movement twice fails — and takes the batch it is in with it.
    const movement = () =>
      db()
        .prepare(
          `INSERT INTO p_shop_stock_adjustment
             (id, variant_id, delta, reason, ref_id, created_at)
           VALUES ('order_paid:o1:v1', 'v1', -10, 'order_paid', 'o1',
                   '2026-10-01T00:00:00.000Z')`,
        )
        .run();

    await movement();
    await expect(movement()).rejects.toThrow(/UNIQUE|PRIMARY/i);
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
