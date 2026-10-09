import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EXPORT_BYTE_LIMIT,
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

const EARLIER = '2026-10-08T08:00:00.000Z';
const LATER = '2026-10-09T08:00:00.000Z';

type Row = Record<string, unknown>;
type ExportedFile = { path: string; text: string };

/** A file of the export, read back as the rows it holds. */
function rowsOf(files: readonly ExportedFile[], name: string): Row[] {
  const file = files.find((entry) => entry.path === `shop/${name}.json`);
  if (file === undefined) {
    throw new Error(`The export has no shop/${name}.json`);
  }
  return JSON.parse(file.text) as Row[];
}

function exported(
  options: {
    rowLimit?: number;
    byteLimit?: number;
    settings?: Record<string, unknown>;
  } = {},
): Promise<ExportedFile[]> {
  return exportShopFiles(db(), { defaultLocale: 'en', ...options });
}

async function table(sql: string): Promise<Row[]> {
  const { results } = await db().prepare(sql).all<Row>();
  return results;
}

/**
 * Two of everything the shop holds, and each pair put in the other way
 * round from the order an export gives it — so that an export which merely
 * read each table as it lay would be seen to.
 */
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
  // A price whose variant is gone: no part of the shop writes one, and a
  // seed or a statement typed by hand can.
  await setPrice({
    variantId: 'ghost',
    currency: 'USD',
    amountMinor: 500,
    source: 'base',
  });
  await setPrice({
    variantId: 'cs-16',
    currency: 'USD',
    amountMinor: 210,
    source: 'base',
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
  const order = (id: string, no: string, at: string) =>
    db()
      .prepare(
        `INSERT INTO p_shop_order
           (id, order_no, status, currency, subtotal_minor, total_minor,
            stripe_payment_intent_id, email, shipping_address, locale,
            created_at, updated_at)
         VALUES (?, ?, 'paid', 'USD', 18500, 18500, ?,
                 'buyer@order.example', ?, 'en', ?, ?)`,
      )
      .bind(
        id,
        no,
        `pi_${id}`,
        JSON.stringify({ recipient: 'Ada', country: 'GB' }),
        at,
        at,
      );
  await db().batch([
    db()
      .prepare(
        `INSERT INTO p_shop_stock_adjustment
           (id, variant_id, delta, reason, ref_id, created_at)
         VALUES ('order_paid:o-1:cs-10', 'cs-10', -100, 'order_paid', 'o-1', ?),
                ('manual:1', 'cs-10', -100, 'manual', NULL, ?)`,
      )
      .bind(LATER, EARLIER),
    order('o-2', 'ND-261009-7K3M9QXB', LATER),
    order('o-1', 'ND-261008-7K3M9QXA', EARLIER),
    db().prepare(
      `INSERT INTO p_shop_order_line
         (id, order_id, variant_id, sku_snapshot, name_snapshot,
          unit_price_minor, quantity)
       VALUES ('o-1:cs-16', 'o-1', 'cs-16', 'CS-16', 'Cap screw M5', 210, 50),
              ('o-1:cs-10', 'o-1', 'cs-10', 'CS-10', 'Cap screw M5', 185, 100)`,
    ),
    db()
      .prepare(
        `INSERT INTO p_shop_stripe_event
           (event_id, type, order_id, payment_intent_id, outcome, processed_at)
         VALUES ('evt_2', 'payment_intent.succeeded', 'o-2', 'pi_o-2', 'paid', ?),
                ('evt_1', 'payment_intent.succeeded', 'o-1', 'pi_o-1', 'paid', ?)`,
      )
      .bind(LATER, EARLIER),
    db()
      .prepare(
        `INSERT INTO p_shop_outbox (id, topic, order_id, ref, created_at)
         VALUES ('order.paid:o-1', 'order.paid', 'o-1', NULL, ?),
                ('payment.refused:evt_9', 'payment.refused', 'o-1', 'pi_9', ?)`,
      )
      .bind(EARLIER, LATER),
    // What an export leaves behind: a cart, a rate, the scheduler's state.
    db()
      .prepare(
        `INSERT INTO p_shop_cart (id, currency, locale, created_at, updated_at, expires_at)
         VALUES (?, 'USD', 'en', ?, ?, '2999-01-01')`,
      )
      .bind('a'.repeat(32), LATER, LATER),
    db()
      .prepare(
        "INSERT INTO p_shop_cart_line (cart_id, variant_id, quantity) VALUES (?, 'cs-10', 100)",
      )
      .bind('a'.repeat(32)),
    db()
      .prepare(
        `INSERT INTO p_shop_rate
           (base_currency, quote_currency, rate, reference_date, fetched_at, source)
         VALUES ('USD', 'EUR', 0.87654321, '2026-10-08', ?, 'ecb')`,
      )
      .bind(LATER),
    db()
      .prepare(
        `INSERT INTO p_shop_state (key, value, updated_at)
         VALUES ('rates_tried_at', ?, ?)`,
      )
      .bind(LATER, LATER),
  ]);
  await storeInquiry({
    id: 'inq-2',
    at: LATER,
    form: { name: 'Grace Hopper', email: 'grace@buyer.example' },
    ipHash: 'e'.repeat(64),
  });
  await storeInquiry({
    id: 'inq-1',
    at: EARLIER,
    form: {
      name: 'Ada Lovelace',
      email: 'ada@buyer.example',
      company: '=Engines; Ltd',
      phone: '+44 20 7946 0000',
      message: 'Two lines,\nand a "quote".\u2028A third, to Unicode.',
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
      'shop/settings.json',
      'shop/stock-adjustments.json',
      'shop/variants.json',
    ]);
    const text = (path: string): string =>
      body.files.find((file) => file.path === path)?.text ?? 'null';
    expect(JSON.parse(text('shop/variants.json'))).toHaveLength(3);
    // The shop's own settings, which Mallok's `site.json` does not carry.
    expect(JSON.parse(text('shop/settings.json'))).toMatchObject({
      rounding: 'ending99',
      inquiry_acknowledge: false,
    });
  });

  it('carries every row of every table, column for column, as it is stored and in a fixed order', async () => {
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
      expect(stored.length, name).toBeGreaterThan(1);
      expect(rowsOf(files, name), name).toEqual(stored);
    }
    // And the order is the one meant, not the one the rows were put in by.
    expect(rowsOf(files, 'stock-adjustments').map((row) => row.id)).toEqual([
      'manual:1',
      'order_paid:o-1:cs-10',
    ]);
    expect(rowsOf(files, 'orders').map((row) => row.id)).toEqual([
      'o-1',
      'o-2',
    ]);
    expect(rowsOf(files, 'order-lines').map((row) => row.id)).toEqual([
      'o-1:cs-10',
      'o-1:cs-16',
    ]);
    expect(rowsOf(files, 'payment-events').map((row) => row.event_id)).toEqual([
      'evt_1',
      'evt_2',
    ]);
    expect(
      rowsOf(files, 'inquiry-lines').map(
        (row) => `${row.inquiry_id}:${row.position}`,
      ),
    ).toEqual(['inq-1:0', 'inq-1:1', 'inq-2:0', 'inq-2:1']);
  });

  it('carries a variant whole, and with it what an export of the content calls its product', async () => {
    await fill();

    expect(rowsOf(await exported(), 'variants')).toEqual(
      (await table('SELECT * FROM p_shop_variant ORDER BY sku')).map((row) => ({
        ...row,
        // The default language's slug, or that of the one it is out in.
        product_slug: row.id === 'wa-5' ? 'export-scheibe' : 'export-screw',
      })),
    );
  });

  it('carries every price whole, the one of a variant that is gone as well', async () => {
    await fill();
    const skus: Record<string, string | null> = {
      'cs-10': 'CS-10',
      'cs-16': 'CS-16',
      ghost: null,
    };

    const prices = rowsOf(await exported(), 'prices');

    expect(prices).toEqual(
      (
        await table('SELECT * FROM p_shop_price ORDER BY variant_id, currency')
      ).map((row) => ({
        ...row,
        variant_sku: skus[String(row.variant_id)],
      })),
    );
    expect(prices.map((row) => `${row.variant_id} ${row.currency}`)).toEqual([
      'cs-10 EUR',
      'cs-10 USD',
      'cs-16 USD',
      'ghost USD',
    ]);
  });

  it('carries an inquiry whole but for the cart it came from and the mark of who sent it', async () => {
    await fill();
    const files = await exported();
    const stored = await table(
      'SELECT * FROM p_shop_inquiry ORDER BY created_at, id',
    );

    expect(rowsOf(files, 'inquiries')).toEqual(
      stored.map(({ cart_id: _cart, ip_hash: _mark, ...kept }) => kept),
    );
    expect(rowsOf(files, 'inquiries').map((row) => row.id)).toEqual([
      'inq-1',
      'inq-2',
    ]);
    const everything = files.map((file) => file.text).join('\n');
    for (const row of stored) {
      expect(everything).not.toContain(String(row.cart_id));
      expect(everything).not.toContain(String(row.ip_hash));
    }
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
      company: '=Engines; Ltd',
      phone: '+44 20 7946 0000',
      message: 'Two lines,\nand a "quote".\u2028A third, to Unicode.',
      subtotal_minor: null,
    });
  });

  it('leaves behind what only this deployment has a use for', async () => {
    await fill();
    const files = await exported();
    const everything = files.map((file) => file.text).join('\n');

    // A visitor's cart, and the id that is all that protects it.
    expect(everything).not.toContain('a'.repeat(32));
    // A rate, which is fetched again, and the scheduler's state.
    expect(everything).not.toContain('0.87654321');
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

  it('accounts for every column of every table it exports', async () => {
    // A table is read with `*`, so that a column a migration adds is not
    // forgotten. This is the other half: a new column has to be looked at
    // here, and either listed or left behind in the export, before it is
    // carried out of the shop without anyone having decided that it should.
    const columns: Record<string, string> = {
      p_shop_variant:
        'id product_group sku option_values moq lead_time_min lead_time_max stock stock_policy weight_grams status sort_order created_at updated_at',
      p_shop_price:
        'variant_id currency amount_minor source rate_used updated_at',
      p_shop_stock_adjustment: 'id variant_id delta reason ref_id created_at',
      p_shop_order:
        'id order_no status currency subtotal_minor shipping_minor tax_minor total_minor stripe_session_id stripe_payment_intent_id email shipping_address locale tracking_no created_at updated_at',
      p_shop_order_line:
        'id order_id variant_id sku_snapshot name_snapshot unit_price_minor quantity',
      p_shop_stripe_event:
        'event_id type order_id payment_intent_id outcome processed_at',
      p_shop_outbox: 'seq id topic order_id ref created_at handled_at',
      p_shop_inquiry:
        'id inquiry_no status name email company phone message locale currency country line_count subtotal_minor subtotal cart_id ip_hash notified_at acknowledged_at created_at updated_at',
      p_shop_inquiry_line:
        'id inquiry_id position variant_id sku name quantity unit_price_minor unit_price line_total',
    };

    expect(Object.keys(columns).sort()).toEqual([...EXPORTED_TABLES].sort());
    for (const [name, expected] of Object.entries(columns)) {
      const actual = (
        await table(`SELECT name FROM pragma_table_info('${name}')`)
      ).map((row) => row.name);
      expect(actual.join(' '), name).toBe(expected);
    }
  });

  it('says in a manifest what is in each file, and carries the settings it is given', async () => {
    await fill();
    const files = await exported({ settings: { rounding: 'integer' } });

    expect(files[0]?.path).toBe('shop/manifest.json');
    expect(JSON.parse(files[0]?.text ?? '{}')).toEqual({
      format: 1,
      tables: {
        variants: { file: 'shop/variants.json', rows: 3 },
        prices: { file: 'shop/prices.json', rows: 4 },
        'stock-adjustments': { file: 'shop/stock-adjustments.json', rows: 2 },
        orders: { file: 'shop/orders.json', rows: 2 },
        'order-lines': { file: 'shop/order-lines.json', rows: 2 },
        'payment-events': { file: 'shop/payment-events.json', rows: 2 },
        outbox: { file: 'shop/outbox.json', rows: 2 },
        inquiries: { file: 'shop/inquiries.json', rows: 2 },
        'inquiry-lines': { file: 'shop/inquiry-lines.json', rows: 4 },
      },
    });
    expect(files[1]).toEqual({
      path: 'shop/settings.json',
      text: '{\n  "rounding": "integer"\n}\n',
    });
  });

  it('exports an empty shop as files that are empty and valid', async () => {
    const files = await exported();

    expect(files).toHaveLength(11);
    expect(files[1]?.text).toBe('{}\n');
    for (const file of files.slice(2)) {
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

  it('writes a row to a line, to every reader of lines', async () => {
    await fill();
    const files = await exported();
    const file = (name: string): string =>
      files.find((entry) => entry.path === `shop/${name}.json`)?.text ?? '';

    // An opening line, a line for each of the three, a closing line.
    expect(file('variants').trimEnd().split('\n')).toHaveLength(5);
    expect(file('variants').endsWith(']\n')).toBe(true);
    // A message with a line separator in it is still one line to whatever
    // splits text the way Unicode says, and the same message when parsed.
    expect(
      file('inquiries')
        .trimEnd()
        .split(/\r\n|[\n\v\f\r\u0085\u2028\u2029]/),
    ).toHaveLength(4);
    expect(file('inquiries')).toContain('\\u2028');
    expect(rowsOf(files, 'inquiries')[0]?.message).toContain('\u2028');
  });

  it('is the same text for the same data', async () => {
    await fill();

    expect(await exported()).toEqual(await exported());
  });

  it('reads everything in one round trip', async () => {
    await fill();

    const calls = await countD1Calls(async () => {
      await exported();
    });

    expect(calls).toBe(1);
  });

  describe('more than one export can carry', () => {
    /** A database whose tables hold what a test says, by their place. */
    function holding(rows: readonly number[]): D1Database {
      const statement = { bind: () => statement };
      return {
        prepare: () => statement,
        batch: async (statements: unknown[]) =>
          statements.map((_, index) => ({
            results: Array.from({ length: rows[index] ?? 0 }, (_unused, n) => ({
              id: `row-${n}`,
            })),
          })),
      } as unknown as D1Database;
    }

    const NAMES = [
      'variants',
      'prices',
      'stock-adjustments',
      'orders',
      'order-lines',
      'payment-events',
      'outbox',
      'inquiries',
      'inquiry-lines',
    ];

    it.each(NAMES.map((name, index) => [name, index] as const))(
      'fails, naming the %s, rather than leave rows out',
      async (name, index) => {
        const counts = (over: number): number[] =>
          NAMES.map((_, place) => (place === index ? over : 7));
        const options = { defaultLocale: 'en', rowLimit: 7 };

        // As many as there may be, in every table.
        await expect(
          exportShopFiles(holding(counts(7)), options),
        ).resolves.toHaveLength(11);
        // One more than that, in this one.
        await expect(
          exportShopFiles(holding(counts(8)), options),
        ).rejects.toThrow(
          new RegExp(
            `^The shop's ${name} have more than 7 rows, which is more than one export can carry\\.`,
          ),
        );
      },
    );

    it('asks each table for one row more than may be, which is how too many is told', async () => {
      await fill();

      // Three variants and four prices, really read.
      await expect(exported({ rowLimit: 4 })).resolves.toHaveLength(11);
      await expect(exported({ rowLimit: 3 })).rejects.toThrow(
        /^The shop's prices have more than 3 rows/,
      );
      await expect(exported({ rowLimit: 2 })).rejects.toThrow(
        /^The shop's variants have more than 2 rows/,
      );
    });

    it('fails when the files together are more text than one export carries', async () => {
      await fill();
      const size = (await exported())
        .slice(2)
        .reduce((total, file) => total + file.text.length * 2, 0);

      await expect(exported({ byteLimit: size })).resolves.toHaveLength(11);
      await expect(exported({ byteLimit: size - 1 })).rejects.toThrow(
        /^The shop's inquiry-lines bring the export past \d+ bytes of text/,
      );
    });

    it('says why in the Worker’s log, with nothing of anyone’s in it', async () => {
      await fill();
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

      try {
        await expect(exported({ rowLimit: 1 })).rejects.toThrow();
        expect(logged.mock.calls).toEqual([
          [
            '{"event":"shop_export_refused","table":"variants","reason":"have more than 1 rows"}',
          ],
        ]);
      } finally {
        logged.mockRestore();
      }
    });

    it('is reported to Mallok as the shop’s failure, and nothing of the shop’s is exported', async () => {
      await db()
        .prepare(
          `WITH RECURSIVE n(i) AS (
             SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?
           )
           INSERT INTO p_shop_stock_adjustment
             (id, variant_id, delta, reason, ref_id, created_at)
           SELECT 'many:' || i, 'cs-10', 1, 'manual', NULL, ? FROM n`,
        )
        .bind(EXPORT_ROW_LIMIT + 1, LATER)
        .run();
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

      let body: {
        pluginExportFailures: { plugin: string; error: string }[];
        files: { path: string }[];
      };
      try {
        body = await (await api('GET', '/_mallok/api/export')).json();
      } finally {
        logged.mockRestore();
      }

      // Mallok's command line and admin refuse to call this a backup.
      expect(body.pluginExportFailures).toEqual([
        {
          plugin: 'shop',
          error: expect.stringMatching(
            new RegExp(
              `^The shop's stock-adjustments have more than ${EXPORT_ROW_LIMIT} rows`,
            ),
          ),
        },
      ]);
      expect(
        body.files.filter((file) => file.path.startsWith('shop/')),
      ).toEqual([]);
    });

    it('has limits a Worker can be expected to hold', () => {
      // Guards, not measurements: see the comment where they are set.
      expect(EXPORT_ROW_LIMIT).toBe(5000);
      expect(EXPORT_BYTE_LIMIT).toBe(16 * 1024 * 1024);
    });
  });
});
