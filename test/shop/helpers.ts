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
      scopes: ['content:write', 'settings:write'],
    }),
  });
  token = ((await minted.json()) as { token: string }).token;

  const settings = await api('PATCH', '/_mallok/api/settings', {
    locales: ['en', 'de', 'fr', 'es'],
    kinds: {
      page: { base: '' },
      article: { base: 'news' },
      product: { base: 'products' },
      application: { base: 'applications' },
      collection: { base: 'collections' },
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

/**
 * Creates a content item through the management API.
 *
 * `frontmatter` is YAML, written as it would be in an `index.md`, without the
 * `title` line or the `---` fences.
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
}): Promise<void> {
  await db()
    .prepare(
      `INSERT INTO p_shop_variant
         (id, product_group, sku, moq, stock, stock_policy, status,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.productGroup,
      input.sku ?? `SKU-${input.id}`,
      input.moq ?? 1,
      input.stock ?? 100,
      input.stockPolicy ?? 'track',
      input.status ?? 'active',
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
      'p_shop_cart_line',
      'p_shop_cart',
      'p_shop_price',
      'p_shop_variant',
      'p_shop_rate',
      'p_shop_state',
    ].map((table) => db().prepare(`DELETE FROM ${table}`)),
  );
}
