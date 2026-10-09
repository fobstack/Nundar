/**
 * What the shop puts into a site export: everything a seller would have to
 * take with them, and nothing that only this deployment has a use for.
 *
 * Mallok asks every plugin for its files when a site is exported, and
 * refuses to call the result a backup if one of them fails. These are the
 * shop's, under `shop/`:
 *
 *   manifest.json           what is in the other files, and how many rows
 *   variants.json           with the slug of the product each belongs to
 *   prices.json             with each variant's SKU
 *   stock-adjustments.json  the ledger of every change of stock
 *   orders.json, order-lines.json
 *   payment-events.json     every payment acted on, and what was done
 *   outbox.json             what a change of an order still owes
 *   inquiries.json, inquiry-lines.json
 *
 * JSON, a row an object, a column a key, as stored: an amount stays the
 * integer of minor units it is, an absent value stays `null`, and nothing
 * is rewritten for a spreadsheet's sake. The CSV a seller reads inquiries
 * from is the admin's own export, which is for reading; this one is for
 * carrying.
 *
 * Not exported: carts, which are a visitor's and gone in a month; exchange
 * rates, which are fetched again; the state of the scheduled work; and, of
 * an inquiry, the cart it came from and the mark of who sent it — the one
 * was a credential and the other means nothing outside this site.
 *
 * Orders and inquiries hold what a person told the shop about themselves.
 * So does this export, which is why Mallok guards it with the `export`
 * scope.
 */

import type { PluginExportFile } from 'mallok/worker';

/**
 * The most rows of one table an export carries.
 *
 * An export is built in one request, in memory, and a table without bound —
 * the ledger, the orders — would one day be more than a request can build.
 * Past this the export fails, by name, rather than leave rows out: Mallok
 * then refuses to call the result a backup, which a file missing its oldest
 * rows would otherwise pass for. The figure is a guard, not a measurement;
 * what a Worker can carry on a real account has not been measured.
 */
export const EXPORT_ROW_LIMIT = 20_000;

/** The folder every file of the shop's is under. */
const FOLDER = 'shop';

/** The version of the layout above, for whoever reads the files. */
const FORMAT = 1;

interface ExportedTable {
  /** The file's name, and the table's in the manifest. */
  readonly name: string;
  readonly table: string;
  /** Ends in a `LIMIT ?`; the default language is bound first when asked. */
  readonly sql: string;
  readonly bindsDefaultLocale?: true;
  /** Columns that stay behind. */
  readonly without?: readonly string[];
}

/**
 * Every column of each table, by `*`: a column a later migration adds is in
 * the export without anyone remembering to add it here. Each is in an order
 * that does not change between two exports of the same data.
 */
const TABLES: readonly ExportedTable[] = [
  {
    name: 'variants',
    table: 'p_shop_variant',
    // A variant belongs to a product by its translation group, an id this
    // database gave it. The product's slug is what an export of the content
    // calls it, so that the two can be put together again somewhere else.
    sql: `SELECT v.*, (
            SELECT c.slug FROM content AS c
            WHERE c.translation_group = v.product_group
            ORDER BY c.locale = ? DESC, c.locale LIMIT 1
          ) AS product_slug
          FROM p_shop_variant AS v ORDER BY v.sku LIMIT ?`,
    bindsDefaultLocale: true,
  },
  {
    name: 'prices',
    table: 'p_shop_price',
    sql: `SELECT v.sku AS sku, p.* FROM p_shop_price AS p
          JOIN p_shop_variant AS v ON v.id = p.variant_id
          ORDER BY v.sku, p.currency LIMIT ?`,
  },
  {
    name: 'stock-adjustments',
    table: 'p_shop_stock_adjustment',
    sql: 'SELECT * FROM p_shop_stock_adjustment ORDER BY created_at, id LIMIT ?',
  },
  {
    name: 'orders',
    table: 'p_shop_order',
    sql: 'SELECT * FROM p_shop_order ORDER BY created_at, id LIMIT ?',
  },
  {
    name: 'order-lines',
    table: 'p_shop_order_line',
    sql: 'SELECT * FROM p_shop_order_line ORDER BY order_id, id LIMIT ?',
  },
  {
    name: 'payment-events',
    table: 'p_shop_stripe_event',
    sql: 'SELECT * FROM p_shop_stripe_event ORDER BY processed_at, event_id LIMIT ?',
  },
  {
    name: 'outbox',
    table: 'p_shop_outbox',
    sql: 'SELECT * FROM p_shop_outbox ORDER BY seq LIMIT ?',
  },
  {
    name: 'inquiries',
    table: 'p_shop_inquiry',
    sql: 'SELECT * FROM p_shop_inquiry ORDER BY created_at, id LIMIT ?',
    without: ['cart_id', 'ip_hash'],
  },
  {
    name: 'inquiry-lines',
    table: 'p_shop_inquiry_line',
    sql: 'SELECT * FROM p_shop_inquiry_line ORDER BY inquiry_id, position LIMIT ?',
  },
];

/** The tables an export carries, for a test to hold against the schema. */
export const EXPORTED_TABLES: readonly string[] = TABLES.map(
  (entry) => entry.table,
);

/** Rows as a file: one to a line, so that two exports can be compared. */
function fileOf(rows: readonly Record<string, unknown>[]): string {
  return rows.length === 0
    ? '[]\n'
    : `[\n${rows.map((row) => JSON.stringify(row)).join(',\n')}\n]\n`;
}

/**
 * The shop's files for a site export, read in one round trip.
 *
 * Throws, naming the table, when one has more rows than an export carries.
 */
export async function exportShopFiles(
  db: D1Database,
  options: {
    readonly defaultLocale: string;
    readonly rowLimit?: number;
  },
): Promise<PluginExportFile[]> {
  const limit = options.rowLimit ?? EXPORT_ROW_LIMIT;
  // One more than the limit is asked for: it is how "too many" is told from
  // "exactly as many as there may be".
  const results = await db.batch<Record<string, unknown>>(
    TABLES.map((entry) =>
      entry.bindsDefaultLocale === true
        ? db.prepare(entry.sql).bind(options.defaultLocale, limit + 1)
        : db.prepare(entry.sql).bind(limit + 1),
    ),
  );

  const counts: Record<string, { file: string; rows: number }> = {};
  const files = TABLES.map((entry, index): PluginExportFile => {
    const rows = results[index]?.results ?? [];
    if (rows.length > limit) {
      throw new Error(
        `The shop's ${entry.name} have more than ${limit} rows, which is more than one export can carry. Nothing of the shop's was exported, so that a file missing rows is not taken for a backup.`,
      );
    }
    const kept =
      entry.without === undefined
        ? rows
        : rows.map((row) =>
            Object.fromEntries(
              Object.entries(row).filter(
                ([column]) => !entry.without?.includes(column),
              ),
            ),
          );
    const path = `${FOLDER}/${entry.name}.json`;
    counts[entry.name] = { file: path, rows: kept.length };
    return { path, text: fileOf(kept) };
  });

  return [
    {
      path: `${FOLDER}/manifest.json`,
      text: `${JSON.stringify({ format: FORMAT, tables: counts }, null, 2)}\n`,
    },
    ...files,
  ];
}
