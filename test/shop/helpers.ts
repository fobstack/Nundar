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
import type { Currency } from '../../src/plugins/shop/lib/currency.js';
import {
  type InquiryLine,
  inquiryFormSchema,
  inquiryStatements,
  newInquiryNo,
} from '../../src/plugins/shop/lib/inquiries.js';

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
      'p_shop_inquiry_line',
      'p_shop_inquiry',
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

/**
 * Stores an inquiry the way the route does: a cart holding exactly the lines
 * being sent, and the route's own statements. Answers with its number.
 *
 * The cart is written by hand because the lines here need no variant to
 * exist: an inquiry is a snapshot, and reading one back depends on nothing
 * else.
 */
export async function storeInquiry(input: {
  readonly id: string;
  readonly at?: string;
  readonly form?: Readonly<Record<string, string>>;
  readonly lines?: readonly InquiryLine[];
  readonly locale?: string;
  readonly currency?: Currency;
  readonly country?: string;
  readonly ipHash?: string | null;
}): Promise<string> {
  const at = input.at ?? '2026-10-09T08:00:00.000Z';
  const lines = input.lines ?? [
    {
      variantId: 'cs-10',
      sku: 'CS-10',
      name: 'Cap screw M5',
      quantity: 300,
      unitPriceMinor: 185,
    },
    {
      variantId: 'wa-5',
      sku: 'WA-5',
      name: 'Washer M5',
      quantity: 50,
      unitPriceMinor: null,
    },
  ];
  const cartId = crypto.randomUUID().replace(/-/g, '');
  await db().batch([
    db()
      .prepare(
        `INSERT INTO p_shop_cart (id, created_at, updated_at, expires_at)
         VALUES (?, ?, ?, '2999-01-01')`,
      )
      .bind(cartId, at, at),
    db()
      .prepare(
        `INSERT INTO p_shop_cart_line (cart_id, variant_id, quantity)
         SELECT ?, json_extract(value, '$.variantId'),
                json_extract(value, '$.quantity')
         FROM json_each(?)`,
      )
      .bind(cartId, JSON.stringify(lines)),
  ]);
  const inquiryNo = newInquiryNo(new Date(at));
  const [stored] = await db().batch(
    inquiryStatements(db(), {
      id: input.id,
      inquiryNo,
      cartId,
      form: inquiryFormSchema.parse({
        name: 'Ada Lovelace',
        email: 'ada@buyer.example',
        ...input.form,
      }),
      locale: input.locale ?? 'en',
      currency: input.currency ?? 'USD',
      country: input.country ?? 'GB',
      ipHash: input.ipHash === undefined ? null : input.ipHash,
      lines,
      now: new Date(at),
    }),
  );
  if ((stored?.meta.changes ?? 0) !== 1) {
    throw new Error(`The inquiry ${input.id} was not stored.`);
  }
  return inquiryNo;
}

/** One call a database of {@link atTheSameMoment} saw: whose, and which. */
interface NotedCall {
  readonly call: number;
  readonly nth: number;
}

/**
 * A database for one of several calls made at the same moment: the real one,
 * noting in `order` each time this call goes to it.
 */
function notingDatabase(call: number, order: NotedCall[]): D1Database {
  const real = db();
  let made = 0;
  const note = <T>(work: () => Promise<T>): Promise<T> => {
    order.push({ call, nth: made });
    made += 1;
    return work();
  };
  // A statement handed to `batch` has to be the real one again.
  const reals = new WeakMap<object, D1PreparedStatement>();
  const noting = (statement: D1PreparedStatement): D1PreparedStatement => {
    const wrapped = {
      bind: (...values: unknown[]) => noting(statement.bind(...values)),
      first: (...columns: string[]) =>
        note(() => statement.first(...(columns as [string]))),
      all: () => note(() => statement.all()),
      run: () => note(() => statement.run()),
      raw: (...options: unknown[]) =>
        note(() => statement.raw(...(options as []))),
    } as unknown as D1PreparedStatement;
    reals.set(wrapped, statement);
    return wrapped;
  };
  return {
    prepare: (sql: string) => noting(real.prepare(sql)),
    batch: (statements: D1PreparedStatement[]) =>
      note(() =>
        real.batch(
          statements.map((statement) => reals.get(statement) ?? statement),
        ),
      ),
  } as unknown as D1Database;
}

/**
 * Runs calls at the same moment, and fails unless they really overlapped:
 * every call had gone to the database for the first time — its reading —
 * before any of them went a second time — its write.
 *
 * Functions called side by side in one test do overlap that way, every
 * time: each runs as far as its first wait, which is its reading, before
 * the next begins. That is what makes a test of a race worth having, and it
 * is taken on trust nowhere: a call that came to wait for something else
 * before its reading would turn the race into a sequence, the guard under
 * test would never be reached, and the test would go on passing. This says
 * so instead.
 *
 * Each call is given a database of its own to use. For requests through
 * `SELF.fetch`, which do not overlap of themselves, see {@link holdWrites}.
 */
export async function atTheSameMoment<T>(
  calls: readonly ((database: D1Database) => Promise<T>)[],
): Promise<PromiseSettledResult<T>[]> {
  const order: NotedCall[] = [];
  const settled = await Promise.allSettled(
    calls.map((call, index) => call(notingDatabase(index, order))),
  );
  const firstSecond = order.findIndex((noted) => noted.nth === 1);
  const late = calls
    .map((_, index) =>
      order.findIndex((noted) => noted.call === index && noted.nth === 0),
    )
    .some(
      (first) => first === -1 || (firstSecond !== -1 && first > firstSecond),
    );
  if (late) {
    throw new Error(
      `The calls did not overlap. They went to the database in this order (call.nth): ${order
        .map((noted) => `${noted.call}.${noted.nth}`)
        .join(' ')}`,
    );
  }
  return settled;
}

/** What calls made {@link atTheSameMoment} came to, when none may fail. */
export function fulfilledValues<T>(
  settled: readonly PromiseSettledResult<T>[],
): T[] {
  return settled.map((result) => {
    if (result.status === 'rejected') {
      throw result.reason;
    }
    return result.value;
  });
}

/** What {@link holdWrites} gives a test to steer by. */
export interface WriteGate {
  /**
   * Resolves once this many writes are being held. A write that never
   * arrives — its request was refused earlier — opens the gate and fails.
   */
  readonly arrived: (count: number) => Promise<void>;
  /** Lets every held write go, and any that comes after. */
  readonly open: () => void;
  /** Opens the gate and takes it away. Call it when the test is over. */
  readonly restore: () => void;
}

/**
 * Holds every batch whose first statement matches, until the test opens the
 * gate: it is how a test puts two requests past their readings before
 * either writes, or changes the data between one request's reading and its
 * write.
 *
 * `Promise.all` over two requests does not make them interleave. In this
 * harness they do about half the time; the other half one request finishes
 * before the other begins, and a guard inside the write is never reached,
 * because an earlier reading of the second request already sees what the
 * first one did. A test of a race has to hold both at the write, every
 * time — or breaking the guard turns it red only sometimes, which proves
 * nothing.
 *
 * `atMost` holds that many and no more, for a test that makes writes of the
 * same kind itself while a request is held.
 *
 * A held write and the test wait by looking at a flag between short sleeps,
 * each on its own timer. A promise settled by one request for another is
 * something the Workers runtime refuses: it stops the Worker.
 */
export function holdWrites(
  isTheWrite: (sql: string) => boolean,
  /** How many matching batches to hold; those after them pass. */
  atMost = Number.POSITIVE_INFINITY,
): WriteGate {
  const databasePrototype = Object.getPrototypeOf(db()) as D1Database;
  const statementPrototype = Object.getPrototypeOf(
    db().prepare('SELECT 1'),
  ) as D1PreparedStatement;
  const realPrepare = databasePrototype.prepare;
  const realBind = statementPrototype.bind;
  const realBatch = databasePrototype.batch;
  // A bound statement is a new object: the mark has to follow it.
  const marked = new WeakSet<object>();
  const pause = (): Promise<void> =>
    new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
  let held = 0;
  let opened = false;

  const spies = [
    vi.spyOn(databasePrototype, 'prepare').mockImplementation(function (
      this: D1Database,
      sql: string,
    ) {
      const statement = realPrepare.call(this, sql);
      if (isTheWrite(sql)) {
        marked.add(statement);
      }
      return statement;
    }),
    vi.spyOn(statementPrototype, 'bind').mockImplementation(function (
      this: D1PreparedStatement,
      ...values: unknown[]
    ) {
      const bound = realBind.apply(this, values);
      if (marked.has(this)) {
        marked.add(bound);
      }
      return bound;
    }),
    vi.spyOn(databasePrototype, 'batch').mockImplementation(async function (
      this: D1Database,
      statements: D1PreparedStatement[],
    ) {
      const first = statements[0];
      if (first !== undefined && marked.has(first) && held < atMost) {
        held += 1;
        // Never for ever: a test that forgot to open the gate fails on
        // what it expected, not on a request that did not come back.
        const deadline = Date.now() + 5000;
        while (!opened && Date.now() < deadline) {
          await pause();
        }
      }
      return realBatch.call(this, statements);
    } as typeof databasePrototype.batch),
  ];

  return {
    arrived: async (count) => {
      const deadline = Date.now() + 3000;
      while (held < count && Date.now() < deadline) {
        await pause();
      }
      if (held < count) {
        opened = true;
        throw new Error(
          `${held} of ${count} requests reached the write: the others were answered before it.`,
        );
      }
    },
    open: () => {
      opened = true;
    },
    restore: () => {
      opened = true;
      for (const spy of spies) {
        spy.mockRestore();
      }
    },
  };
}

/** The batch that stores an inquiry, for {@link holdWrites}. */
export const INQUIRY_WRITE = (sql: string): boolean =>
  sql.includes('INSERT INTO p_shop_inquiry\n');
