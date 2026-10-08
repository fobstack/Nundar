/**
 * Shared set-up for the shop plugin's tests.
 *
 * A site is brought up the way an operator would bring one up — a first
 * request (which runs the migrations, the plugin's included), an
 * administrator, a token, settings, the plugin switched on — through Mallok's
 * real HTTP API. Nothing here creates a table or a content row by hand, so a
 * test exercises the same path a deployed shop does.
 */

import { env, SELF } from 'cloudflare:test';
import { vi } from 'vitest';

export const ORIGIN = 'https://shop-test.example';

const EMAIL = 'owner@example.com';
const PASSWORD = 'a sufficiently long password';

let token = '';
let ready: Promise<void> | null = null;

export function db(): D1Database {
  return (env as unknown as { DB: D1Database }).DB;
}

export async function api(
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  return SELF.fetch(`${ORIGIN}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function bootstrap(): Promise<void> {
  // The first request runs Mallok's migrations and the plugin's.
  await SELF.fetch(`${ORIGIN}/`);

  const json = { 'content-type': 'application/json' };
  await SELF.fetch(`${ORIGIN}/_mallok/api/auth/bootstrap`, {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const session = await SELF.fetch(`${ORIGIN}/_mallok/api/auth/login`, {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const cookie = (session.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  const { csrf } = (await session.json()) as { csrf: string };

  const minted = await SELF.fetch(`${ORIGIN}/_mallok/api/tokens`, {
    method: 'POST',
    headers: { ...json, cookie, 'x-mallok-csrf': csrf },
    body: JSON.stringify({
      name: 'shop-test',
      // `export` reads a plugin panel's rows and records, as the admin does.
      scopes: ['content:write', 'settings:write', 'media:write', 'export'],
    }),
  });
  token = ((await minted.json()) as { token: string }).token;

  const settings = await api('PATCH', '/_mallok/api/settings', {
    locales: ['en', 'de', 'fr', 'es'],
    kinds: {
      page: { base: '' },
      article: { base: 'news' },
      product: { base: 'products' },
      collection: { base: 'collections' },
      application: { base: 'industries' },
      case: { base: 'case-studies' },
      faq: { base: 'faq' },
      tool: { base: 'tools' },
    },
    nav: {
      en: [{ label: 'Products', href: '/products' }],
      de: [{ label: 'Produkte', href: '/de/products' }],
    },
  });
  if (!settings.ok) {
    throw new Error(`Settings were refused: ${await settings.text()}`);
  }

  const enabled = await api('POST', '/_mallok/api/plugins/shop/enabled', {
    enabled: true,
  });
  if (!enabled.ok) {
    throw new Error(`The shop plugin was refused: ${await enabled.text()}`);
  }

  // The first request above cached the home page as it was before any of
  // these settings existed. No purge token is bound in tests, so drop it by
  // hand rather than have a test read a page from before its own set-up.
  await caches.default.delete(new Request(`${ORIGIN}/`));
}

/** Brings the site up once per test file. */
export function ensureSite(): Promise<void> {
  ready ??= bootstrap();
  return ready;
}

export interface TestContent {
  readonly id: string;
  readonly path: string;
  readonly translationGroup: string;
}

export type TestProduct = TestContent;

/** A PNG of one pixel: the smallest file Mallok accepts as an image. */
const PIXEL = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  ),
  (character) => character.charCodeAt(0),
);

/**
 * Bytes for a test file of the kind its name says, different for every
 * `seed`: Mallok stores media by content hash, so two files with the same
 * bytes would be one file.
 */
export function testFile(name: string, seed: number): Uint8Array {
  if (name.endsWith('.pdf')) {
    return new TextEncoder().encode(`%PDF-1.4\n% test file ${seed}\n%%EOF\n`);
  }
  // Bytes after the image's end marker are ignored by every reader.
  return Uint8Array.from([...PIXEL, seed]);
}

/**
 * Uploads a file the way `mallok publish` does, and returns the hash a
 * content item then names it by in `assets`.
 */
export async function uploadMedia(
  bytes: Uint8Array,
  filename: string,
): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const sha256 = [...digest]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  const stored = await SELF.fetch(`${ORIGIN}/_mallok/api/media/${sha256}`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${token}`,
      'x-mallok-filename': encodeURIComponent(filename),
    },
    body: bytes,
  });
  if (!stored.ok) {
    throw new Error(`Media was refused: ${await stored.text()}`);
  }
  return sha256;
}

/**
 * Creates a content item through the management API.
 *
 * `frontmatter` is YAML, written as it would be in an `index.md`, without the
 * `title` line or the `---` fences. `assets` maps the relative paths the
 * front matter and the body use (`images/cover.png`) to uploaded files.
 */
export async function createContent(input: {
  readonly kind: string;
  readonly title: string;
  readonly slug: string;
  readonly locale?: string;
  readonly translationGroup?: string;
  readonly status?: 'draft' | 'published';
  readonly frontmatter?: string;
  readonly body?: string;
  readonly assets?: Readonly<Record<string, string>>;
}): Promise<TestContent> {
  const frontmatter = [
    `title: ${input.title}`,
    ...(input.frontmatter === undefined ? [] : [input.frontmatter.trim()]),
  ].join('\n');
  const created = await api('POST', '/_mallok/api/content', {
    kind: input.kind,
    slug: input.slug,
    locale: input.locale ?? 'en',
    status: input.status ?? 'published',
    ...(input.translationGroup === undefined
      ? {}
      : { translationGroup: input.translationGroup }),
    ...(input.assets === undefined ? {} : { assets: input.assets }),
    markdown: `---\n${frontmatter}\n---\n\n${input.body ?? 'Body.'}\n`,
  });
  if (created.status !== 201) {
    throw new Error(`Content was refused: ${await created.text()}`);
  }
  const { id, path } = (await created.json()) as { id: string; path: string };
  const row = await db()
    .prepare('SELECT translation_group FROM content WHERE id = ?')
    .bind(id)
    .first<{ translation_group: string }>();
  if (row === null) {
    throw new Error('The created content is not in the content table.');
  }
  return { id, path, translationGroup: row.translation_group };
}

/** Creates a product content item through the management API. */
export function createProduct(input: {
  readonly title: string;
  readonly slug: string;
  readonly locale?: string;
  readonly translationGroup?: string;
  readonly status?: 'draft' | 'published';
}): Promise<TestProduct> {
  return createContent({ kind: 'product', ...input });
}

const NOW = '2026-10-01T00:00:00.000Z';

/** Inserts a variant row, as the admin's editor will once it exists. */
export async function createVariant(input: {
  readonly id: string;
  readonly productGroup: string;
  readonly sku?: string;
  readonly moq?: number;
  readonly stock?: number;
  readonly stockPolicy?: 'track' | 'made_to_order';
  readonly status?: 'active' | 'archived';
  /** Option name to value, as the admin stores it: `{ length: '10 mm' }`. */
  readonly optionValues?: Readonly<Record<string, string>>;
  /** Business days, both ends or neither. */
  readonly leadTime?: readonly [number, number];
  readonly sortOrder?: number;
}): Promise<void> {
  await db()
    .prepare(
      `INSERT INTO p_shop_variant
         (id, product_group, sku, option_values, moq, lead_time_min,
          lead_time_max, stock, stock_policy, status, sort_order,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.productGroup,
      input.sku ?? `SKU-${input.id}`,
      JSON.stringify(input.optionValues ?? {}),
      input.moq ?? 1,
      input.leadTime?.[0] ?? null,
      input.leadTime?.[1] ?? null,
      input.stock ?? 100,
      input.stockPolicy ?? 'track',
      input.status ?? 'active',
      input.sortOrder ?? 0,
      NOW,
      NOW,
    )
    .run();
}

export async function setPrice(input: {
  readonly variantId: string;
  readonly currency: string;
  readonly amountMinor: number;
  readonly source: 'base' | 'auto' | 'manual';
  readonly rateUsed?: number | null;
}): Promise<void> {
  await db()
    .prepare(
      `INSERT INTO p_shop_price
         (variant_id, currency, amount_minor, source, rate_used, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (variant_id, currency) DO UPDATE SET
         amount_minor = excluded.amount_minor, source = excluded.source,
         rate_used = excluded.rate_used, updated_at = excluded.updated_at`,
    )
    .bind(
      input.variantId,
      input.currency,
      input.amountMinor,
      input.source,
      input.rateUsed ?? null,
      NOW,
    )
    .run();
}

export async function priceOf(
  variantId: string,
  currency: string,
): Promise<{
  amount_minor: number;
  source: string;
  rate_used: number | null;
} | null> {
  return db()
    .prepare(
      `SELECT amount_minor, source, rate_used FROM p_shop_price
       WHERE variant_id = ? AND currency = ?`,
    )
    .bind(variantId, currency)
    .first();
}

export async function setRate(
  quote: string,
  rate: number,
  referenceDate = '2026-09-30',
): Promise<void> {
  await db()
    .prepare(
      `INSERT INTO p_shop_rate
         (base_currency, quote_currency, rate, reference_date, fetched_at, source)
       VALUES ('USD', ?, ?, ?, ?, 'test')
       ON CONFLICT (base_currency, quote_currency) DO UPDATE SET
         rate = excluded.rate, reference_date = excluded.reference_date`,
    )
    .bind(quote, rate, referenceDate, NOW)
    .run();
}

/** Empties the shop's own tables between tests. */
export async function clearShopTables(): Promise<void> {
  await db().batch(
    [
      'p_shop_outbox',
      'p_shop_stock_adjustment',
      'p_shop_stripe_event',
      'p_shop_order_line',
      'p_shop_order',
      'p_shop_cart_line',
      'p_shop_cart',
      'p_shop_price',
      'p_shop_variant',
      'p_shop_rate',
      'p_shop_state',
    ].map((table) => db().prepare(`DELETE FROM ${table}`)),
  );
}

export async function stockOf(variantId: string): Promise<number | null> {
  const row = await db()
    .prepare('SELECT stock FROM p_shop_variant WHERE id = ?')
    .bind(variantId)
    .first<{ stock: number }>();
  return row?.stock ?? null;
}

export async function setStock(
  variantId: string,
  stock: number,
): Promise<void> {
  await db()
    .prepare('UPDATE p_shop_variant SET stock = ? WHERE id = ?')
    .bind(stock, variantId)
    .run();
}

/**
 * A database that is the real one, except at the moments a test names.
 *
 * `before` and `after` run around each `batch`, counted from zero. A test
 * uses them to do what cannot be arranged from outside: change the data
 * between a function's reading and its writing, or make a write that has
 * committed look as if its answer never came back.
 */
export function interceptBatches(hooks: {
  readonly before?: (index: number) => Promise<void> | void;
  readonly after?: (index: number) => Promise<void> | void;
}): D1Database {
  const real = db();
  let index = 0;
  return {
    prepare: (sql: string) => real.prepare(sql),
    batch: async (statements: D1PreparedStatement[]) => {
      const current = index;
      index += 1;
      await hooks.before?.(current);
      const results = await real.batch(statements);
      await hooks.after?.(current);
      return results;
    },
  } as unknown as D1Database;
}

export interface OutboxEntry {
  id: string;
  topic: string;
  order_id: string;
  ref: string | null;
  handled_at: string | null;
}

/** Every outbox row, in the order it was committed. */
export async function outboxRows(): Promise<OutboxEntry[]> {
  const { results } = await db()
    .prepare(
      `SELECT id, topic, order_id, ref, handled_at FROM p_shop_outbox
       ORDER BY seq`,
    )
    .all<OutboxEntry>();
  return results;
}

/**
 * Runs `work` and returns how many calls reached D1 while it ran.
 *
 * Counted on the prototypes the real objects share: a statement's own
 * execution, and the database's batch. A batch is one call however many
 * statements it carries, which is the unit a round trip is measured in.
 */
export async function countD1Calls(
  work: () => Promise<unknown>,
): Promise<number> {
  const statementPrototype = Object.getPrototypeOf(
    db().prepare('SELECT 1'),
  ) as D1PreparedStatement;
  const databasePrototype = Object.getPrototypeOf(db()) as D1Database;
  const spies = [
    vi.spyOn(databasePrototype, 'batch'),
    vi.spyOn(statementPrototype, 'run'),
    vi.spyOn(statementPrototype, 'all'),
    vi.spyOn(statementPrototype, 'first'),
  ];
  try {
    await work();
    return spies.reduce((total, spy) => total + spy.mock.calls.length, 0);
  } finally {
    for (const spy of spies) {
      spy.mockRestore();
    }
  }
}

/**
 * Signs a webhook body the way Stripe does: HMAC-SHA256 over
 * `<timestamp>.<body>`, keyed by the endpoint's signing secret, as hex.
 *
 * Written out here rather than borrowed from the code under test, so a
 * mistake in the verifier cannot be mirrored by the signer.
 *
 * An empty secret is signed with a single zero byte. HMAC pads a short key
 * with zero bytes, so that is the same MAC an empty key gives — the one an
 * attacker would compute against a shop with no secret set — and WebCrypto
 * refuses to import a key of length zero.
 */
export async function signStripePayload(
  payload: string,
  timestamp: number,
  secret: string,
): Promise<string> {
  const mac = new Uint8Array(
    await crypto.subtle.sign(
      'HMAC',
      await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret === '' ? '\u0000' : secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      ),
      new TextEncoder().encode(`${timestamp}.${payload}`),
    ),
  );
  return [...mac].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
