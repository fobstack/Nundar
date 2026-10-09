/**
 * What the shop puts into a site export: everything a seller would have to
 * take with them, and nothing that only this deployment has a use for.
 *
 * Mallok asks every plugin for its files when a site is exported, and
 * refuses to call the result a backup if one of them fails. These are the
 * shop's, under `shop/`:
 *
 *   manifest.json           what is in the other files, and how many rows
 *   settings.json           the shop's own settings, as the admin has them
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
 * was a credential and the other means nothing outside this site. The shop
 * stores no secret; were it to, a secret would not be exported either.
 *
 * Orders and inquiries hold what a person told the shop about themselves.
 * So does this export, which is why Mallok guards it with the `export`
 * scope.
 */

import type { PluginExportFile } from 'mallok/worker';

/**
 * The most rows of one table an export carries, and the most text the
 * shop's files may come to together.
 *
 * An export is built in one request, in memory: the rows as D1 hands them
 * over, the files made of them, and Mallok's own copy when it answers. A
 * table without bound — the ledger, the orders — would one day be more than
 * a Worker's memory. Past either figure the export fails, saying which
 * table, rather than leave rows out: Mallok then refuses to call the result
 * a backup, which a file missing its oldest rows would otherwise pass for.
 *
 * Both are guards, not measurements. Five thousand rows of the widest table
 * there is — an inquiry with a message as long as one may be — are about
 * thirty megabytes as read, which a Worker can hold; twenty thousand, the
 * first figure here, were a hundred and ten, which it cannot. What a
 * Worker's CPU allowance lets through has not been measured on a real
 * account, and on the smallest plan it may well be less than this.
 */
export const EXPORT_ROW_LIMIT = 5000;

export const EXPORT_BYTE_LIMIT = 16 * 1024 * 1024;

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
    // Every price, the one of a variant that is gone as well: a row left
    // out here would be a row the manifest could not show to be missing.
    sql: `SELECT p.*, v.sku AS variant_sku FROM p_shop_price AS p
          LEFT JOIN p_shop_variant AS v ON v.id = p.variant_id
          ORDER BY p.variant_id, p.currency LIMIT ?`,
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

/**
 * A row as one line of JSON, for every reader. `JSON.stringify` leaves the
 * line and paragraph separators and NEL as they are, which is valid JSON and
 * a line break to whatever splits text the way Unicode says. Written as
 * escapes they are the same characters to a JSON parser.
 */
function lineOf(row: Record<string, unknown>): string {
  return JSON.stringify(row).replace(
    /[\u0085\u2028\u2029]/g,
    (character) =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

/** Rows as a file: one to a line, so that two exports can be compared. */
function fileOf(rows: readonly Record<string, unknown>[]): string {
  return rows.length === 0 ? '[]\n' : `[\n${rows.map(lineOf).join(',\n')}\n]\n`;
}

/** Why the shop's part of an export was refused. */
export class ExportTooLargeError extends Error {}

/**
 * Refuses an export, and says so in the Worker's log as well: Mallok's
 * command line and admin show which plugin failed and not why.
 */
function refuse(table: string, what: string): never {
  console.error(
    JSON.stringify({ event: 'shop_export_refused', table, reason: what }),
  );
  throw new ExportTooLargeError(
    `The shop's ${table} ${what}, which is more than one export can carry. Nothing of the shop's was exported, so that a file missing rows is not taken for a backup.`,
  );
}

/**
 * The shop's files for a site export, read in one round trip.
 *
 * Throws, naming the table, when one has more rows than an export carries
 * or the files together are more text than one does.
 */
export async function exportShopFiles(
  db: D1Database,
  options: {
    readonly defaultLocale: string;
    /** The shop's settings, as Mallok hands them to the plugin. */
    readonly settings?: Readonly<Record<string, unknown>>;
    readonly rowLimit?: number;
    readonly byteLimit?: number;
  },
): Promise<PluginExportFile[]> {
  const limit = options.rowLimit ?? EXPORT_ROW_LIMIT;
  const byteLimit = options.byteLimit ?? EXPORT_BYTE_LIMIT;
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
  let bytes = 0;
  const files = TABLES.map((entry, index): PluginExportFile => {
    const rows = results[index]?.results ?? [];
    if (rows.length > limit) {
      refuse(entry.name, `have more than ${limit} rows`);
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
    const text = fileOf(kept);
    // Counted in UTF-16 units, which is what a string costs in memory.
    bytes += text.length * 2;
    if (bytes > byteLimit) {
      refuse(entry.name, `bring the export past ${byteLimit} bytes of text`);
    }
    counts[entry.name] = { file: path, rows: kept.length };
    return { path, text };
  });

  return [
    {
      path: `${FOLDER}/manifest.json`,
      text: `${JSON.stringify({ format: FORMAT, tables: counts }, null, 2)}\n`,
    },
    {
      path: `${FOLDER}/settings.json`,
      text: `${JSON.stringify(options.settings ?? {}, null, 2)}\n`,
    },
    ...files,
  ];
}
