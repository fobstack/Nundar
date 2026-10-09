import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  EXPORT_ROW_LIMIT,
  EXPORTED_TABLES,
  exportShopFiles,
} from '../../src/plugins/shop/lib/export.js';
import {
  api,
  clearShopTables,
  countD1Calls,
  createProduct,
  createVariant,
  db,
  ensureSite,
  setPrice,
  storeInquiry,
  type TestProduct,
} from './helpers.js';

let screw: TestProduct;
let washer: TestProduct;

const AT = '2026-10-09T08:00:00.000Z';

/** A file of the export, read back as the rows it holds. */
function rowsOf(
  files: readonly { path: string; text: string }[],
  name: string,
): Record<string, unknown>[] {
  const file = files.find((entry) => entry.path === `shop/${name}.json`);
  if (file === undefined) {
    throw new Error(`The export has no shop/${name}.json`);
  }
  return JSON.parse(file.text) as Record<string, unknown>[];
}

function exported(rowLimit?: number) {
  return exportShopFiles(db(), {
    defaultLocale: 'en',
    ...(rowLimit === undefined ? {} : { rowLimit }),
  });
}

async function table(sql: string): Promise<Record<string, unknown>[]> {
  const { results } = await db().prepare(sql).all<Record<string, unknown>>();
  return results;
}

/** One of everything the shop holds. */
async function fill(): Promise<void> {
  await createVariant({
    id: 'cs-16',
    productGroup: screw.translationGroup,
    sku: 'CS-16',
    moq: 50,
    stock: 0,
    stockPolicy: 'made_to_order',
    optionValues: { length: '16 mm' },
    leadTime: [10, 15],
  });
  await createVariant({
    id: 'cs-10',
    productGroup: screw.translationGroup,
    sku: 'CS-10',
    moq: 100,
    stock: 400,
  });
  await createVariant({
    id: 'wa-5',
    productGroup: washer.translationGroup,
    sku: 'WA-5',
  });
  await setPrice({
    variantId: 'cs-10',
    currency: 'USD',
    amountMinor: 185,
    source: 'base',
  });
  await setPrice({
    variantId: 'cs-10',
    currency: 'EUR',
    amountMinor: 199,
    source: 'auto',
    rateUsed: 0.92,
  });
  await setPrice({
    variantId: 'cs-16',
    currency: 'USD',
    amountMinor: 210,
    source: 'base',
  });
  await db().batch([
    db()
      .prepare(
        `INSERT INTO p_shop_stock_adjustment
           (id, variant_id, delta, reason, ref_id, created_at)
         VALUES ('manual:1', 'cs-10', -100, 'manual', NULL, ?),
                ('order_paid:o-1:cs-10', 'cs-10', -100, 'order_paid', 'o-1', ?)`,
      )
      .bind('2026-10-08T08:00:00.000Z', AT),
    db()
      .prepare(
        `INSERT INTO p_shop_order
           (id, order_no, status, currency, subtotal_minor, total_minor,
            stripe_payment_intent_id, email, shipping_address, locale,
            created_at, updated_at)
         VALUES ('o-1', 'ND-261009-7K3M9QXA', 'paid', 'USD', 18500, 18500,
                 'pi_1', 'buyer@order.example', ?, 'en', ?, ?)`,
      )
      .bind(JSON.stringify({ recipient: 'Ada', country: 'GB' }), AT, AT),
    db().prepare(
      `INSERT INTO p_shop_order_line
         (id, order_id, variant_id, sku_snapshot, name_snapshot,
          unit_price_minor, quantity)
       VALUES ('o-1:cs-10', 'o-1', 'cs-10', 'CS-10', 'Cap screw M5', 185, 100)`,
    ),
    db()
      .prepare(
        `INSERT INTO p_shop_stripe_event
           (event_id, type, order_id, payment_intent_id, outcome, processed_at)
         VALUES ('evt_1', 'payment_intent.succeeded', 'o-1', 'pi_1', 'paid', ?)`,
      )
      .bind(AT),
    db()
      .prepare(
        `INSERT INTO p_shop_outbox (id, topic, order_id, ref, created_at)
         VALUES ('order.paid:o-1', 'order.paid', 'o-1', NULL, ?)`,
      )
      .bind(AT),
    // What an export leaves behind: a cart, a rate, the scheduler's state.
    db()
      .prepare(
        `INSERT INTO p_shop_cart (id, currency, locale, created_at, updated_at, expires_at)
         VALUES (?, 'USD', 'en', ?, ?, '2999-01-01')`,
      )
      .bind('a'.repeat(32), AT, AT),
    db()
      .prepare(
        "INSERT INTO p_shop_cart_line (cart_id, variant_id, quantity) VALUES (?, 'cs-10', 100)",
      )
      .bind('a'.repeat(32)),
    db()
      .prepare(
        `INSERT INTO p_shop_state (key, value, updated_at)
         VALUES ('rates_tried_at', ?, ?)`,
      )
      .bind(AT, AT),
  ]);
  await storeInquiry({
    id: 'inq-1',
    at: AT,
    form: {
      name: 'Ada Lovelace',
      email: 'ada@buyer.example',
      company: '=Engines; Ltd',
      message: 'Two lines,\nand a "quote".',
    },
    ipHash: 'f'.repeat(64),
  });
}

describe('the shop in a site export', () => {
  beforeAll(async () => {
    await ensureSite();
    screw = await createProduct({ title: 'Cap screw', slug: 'export-screw' });
    await createProduct({
      title: 'Zylinderschraube',
      slug: 'export-schraube',
      locale: 'de',
      translationGroup: screw.translationGroup,
    });
    // Out in German only: it has no slug in the default language.
    washer = await createProduct({
      title: 'Scheibe',
      slug: 'export-scheibe',
      locale: 'de',
    });
  });

  beforeEach(clearShopTables);

  it('is part of Mallok’s export, with no plugin reported as failed', async () => {
    await fill();

    const response = await api('GET', '/_mallok/api/export');
    const body = (await response.json()) as {
      pluginExportFailures: unknown[];
      files: { path: string; text?: string }[];
    };

    expect(response.status).toBe(200);
    // Mallok refuses to call an export a backup when this is not empty.
    expect(body.pluginExportFailures).toEqual([]);
    expect(
      body.files
        .map((file) => file.path)
        .filter((path) => path.startsWith('shop/'))
        .sort(),
    ).toEqual([
      'shop/inquiries.json',
      'shop/inquiry-lines.json',
      'shop/manifest.json',
      'shop/order-lines.json',
      'shop/orders.json',
      'shop/outbox.json',
      'shop/payment-events.json',
      'shop/prices.json',
      'shop/stock-adjustments.json',
      'shop/variants.json',
    ]);
    const variants = body.files.find(
      (file) => file.path === 'shop/variants.json',
    );
    expect(JSON.parse(variants?.text ?? '[]')).toHaveLength(3);
  });

  it('carries every row of every table, column for column, as it is stored', async () => {
    await fill();
    const files = await exported();

    for (const [name, sql] of [
      [
        'stock-adjustments',
        'SELECT * FROM p_shop_stock_adjustment ORDER BY created_at, id',
      ],
      ['orders', 'SELECT * FROM p_shop_order ORDER BY created_at, id'],
      ['order-lines', 'SELECT * FROM p_shop_order_line ORDER BY order_id, id'],
      [
        'payment-events',
        'SELECT * FROM p_shop_stripe_event ORDER BY processed_at, event_id',
      ],
      ['outbox', 'SELECT * FROM p_shop_outbox ORDER BY seq'],
      [
        'inquiry-lines',
        'SELECT * FROM p_shop_inquiry_line ORDER BY inquiry_id, position',
      ],
    ] as const) {
      const stored = await table(sql);
      expect(stored.length, name).toBeGreaterThan(0);
      expect(rowsOf(files, name), name).toEqual(stored);
    }
    // A variant, and with it what an export of the content calls its product.
    expect(rowsOf(files, 'variants')).toEqual(
      (await table('SELECT * FROM p_shop_variant ORDER BY sku')).map((row) => ({
        ...row,
        product_slug: row.id === 'wa-5' ? 'export-scheibe' : 'export-screw',
      })),
    );
    // A price, and with it the SKU it is a price of.
    expect(rowsOf(files, 'prices')).toEqual([
      expect.objectContaining({
        sku: 'CS-10',
        currency: 'EUR',
        amount_minor: 199,
        source: 'auto',
        rate_used: 0.92,
      }),
      expect.objectContaining({
        sku: 'CS-10',
        currency: 'USD',
        amount_minor: 185,
        source: 'base',
        rate_used: null,
      }),
      expect.objectContaining({
        sku: 'CS-16',
        currency: 'USD',
        amount_minor: 210,
      }),
    ]);
  });

  it('names a product by its slug in the default language, or in the one it is out in', async () => {
    await fill();

    const bySku = Object.fromEntries(
      rowsOf(await exported(), 'variants').map((row) => [
        row.sku,
        row.product_slug,
      ]),
    );

    expect(bySku).toEqual({
      'CS-10': 'export-screw',
      'CS-16': 'export-screw',
      'WA-5': 'export-scheibe',
    });
  });

  it('keeps an amount the whole number it is, and what was typed as it was typed', async () => {
    await fill();
    const files = await exported();

    expect(rowsOf(files, 'orders')[0]).toMatchObject({
      total_minor: 18500,
      stripe_session_id: null,
      shipping_address: '{"recipient":"Ada","country":"GB"}',
    });
    // Nothing is rewritten for a spreadsheet's sake: this is for carrying.
    expect(rowsOf(files, 'inquiries')[0]).toMatchObject({
      name: 'Ada Lovelace',
      company: '=Engines; Ltd',
      message: 'Two lines,\nand a "quote".',
      subtotal_minor: null,
    });
  });

  it('leaves behind the cart an inquiry came from and the mark of who sent it', async () => {
    await fill();
    const files = await exported();
    const [inquiry] = rowsOf(files, 'inquiries');
    const stored = await table('SELECT cart_id, ip_hash FROM p_shop_inquiry');

    expect(inquiry).not.toHaveProperty('cart_id');
    expect(inquiry).not.toHaveProperty('ip_hash');
    const everything = files.map((file) => file.text).join('\n');
    expect(everything).not.toContain(String(stored[0]?.cart_id));
    expect(everything).not.toContain('f'.repeat(64));
  });

  it('leaves behind what only this deployment has a use for', async () => {
    await fill();
    const files = await exported();
    const everything = files.map((file) => file.text).join('\n');

    // A visitor's cart, and the id that is all that protects it.
    expect(everything).not.toContain('a'.repeat(32));
    expect(everything).not.toContain('rates_tried_at');
    expect(files.map((file) => file.path).join(' ')).not.toMatch(
      /cart|rate|state/,
    );
  });

  it('accounts for every table the shop has: exported, or left behind on purpose', async () => {
    const all = (
      await table(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'p_shop_%' ORDER BY name",
      )
    ).map((row) => row.name);

    // A table a later migration adds has to be put on one of these lists.
    expect(all).toEqual(
      [
        ...EXPORTED_TABLES,
        'p_shop_cart',
        'p_shop_cart_line',
        'p_shop_rate',
        'p_shop_state',
      ].sort(),
    );
  });

  it('says in a manifest what is in each file', async () => {
    await fill();
    const files = await exported();

    expect(files[0]?.path).toBe('shop/manifest.json');
    expect(JSON.parse(files[0]?.text ?? '{}')).toEqual({
      format: 1,
      tables: {
        variants: { file: 'shop/variants.json', rows: 3 },
        prices: { file: 'shop/prices.json', rows: 3 },
        'stock-adjustments': { file: 'shop/stock-adjustments.json', rows: 2 },
        orders: { file: 'shop/orders.json', rows: 1 },
        'order-lines': { file: 'shop/order-lines.json', rows: 1 },
        'payment-events': { file: 'shop/payment-events.json', rows: 1 },
        outbox: { file: 'shop/outbox.json', rows: 1 },
        inquiries: { file: 'shop/inquiries.json', rows: 1 },
        'inquiry-lines': { file: 'shop/inquiry-lines.json', rows: 2 },
      },
    });
  });

  it('exports an empty shop as files that are empty and valid', async () => {
    const files = await exported();

    expect(files).toHaveLength(10);
    for (const file of files.slice(1)) {
      expect(file.text, file.path).toBe('[]\n');
    }
    expect(
      Object.values(
        (
          JSON.parse(files[0]?.text ?? '{}') as {
            tables: Record<string, { rows: number }>;
          }
        ).tables,
      ).map((entry) => entry.rows),
    ).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('is the same text for the same data, a row to a line', async () => {
    await fill();

    const first = await exported();
    const second = await exported();

    expect(second).toEqual(first);
    const variants = first.find((file) => file.path === 'shop/variants.json');
    // An opening line, a line for each of the three, a closing line.
    expect(variants?.text.trimEnd().split('\n')).toHaveLength(5);
    expect(variants?.text.endsWith(']\n')).toBe(true);
  });

  it('reads everything in one round trip', async () => {
    await fill();

    const calls = await countD1Calls(async () => {
      await exported();
    });

    expect(calls).toBe(1);
  });

  it('fails, naming the table, rather than leave rows out', async () => {
    await fill();

    // Three variants: as many as there may be, and one more than that.
    await expect(exported(3)).resolves.toHaveLength(10);
    await expect(exported(2)).rejects.toThrow(
      /^The shop's variants have more than 2 rows, which is more than one export can carry\./,
    );
    // And any other table the same: a fourth price, with three variants.
    await setPrice({
      variantId: 'cs-16',
      currency: 'EUR',
      amountMinor: 199,
      source: 'manual',
    });
    await expect(exported(3)).rejects.toThrow(
      /^The shop's prices have more than 3 rows/,
    );
    expect(EXPORT_ROW_LIMIT).toBeGreaterThanOrEqual(10_000);
  });
});
