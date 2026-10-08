import type { PluginContext, PluginRecordInput } from 'mallok/worker';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadVariant,
  onProductDeleted,
  removeVariant,
  saveVariant,
} from '../../src/plugins/shop/lib/variant-records.js';
import {
  api,
  clearShopTables,
  createContent,
  createProduct,
  db,
  ensureSite,
  interceptBatches,
  priceOf,
  setRate,
  stockOf,
  type TestProduct,
} from './helpers.js';

/**
 * Variants, edited the way the admin edits them.
 *
 * The admin's form talks to Mallok, and Mallok to the shop's three handlers.
 * The first half of this file goes the whole way, through Mallok's own API,
 * to hold the wiring: the manifest's fields, the panel attached to a product,
 * the shapes that cross. The second half calls the handlers directly, for
 * what cannot be seen from outside — the purge a save asks for, and a write
 * that loses a race.
 */

const PANEL = '/_mallok/api/plugins/shop/panels/variants';

interface Saved {
  readonly status: number;
  readonly id?: string;
  readonly errors?: Readonly<Record<string, string>>;
  readonly error?: string;
}

async function saved(response: Response): Promise<Saved> {
  const body = (await response.json()) as Omit<Saved, 'status'>;
  return { status: response.status, ...body };
}

function create(
  product: TestProduct,
  values: Record<string, unknown>,
): Promise<Saved> {
  return api('POST', `${PANEL}/records`, {
    attachedTo: product.translationGroup,
    values,
  }).then(saved);
}

function update(
  product: TestProduct,
  id: string,
  values: Record<string, unknown>,
): Promise<Saved> {
  return api('PUT', `${PANEL}/records/${id}`, {
    attachedTo: product.translationGroup,
    values,
  }).then(saved);
}

async function load(id: string): Promise<Record<string, unknown> | null> {
  const response = await api('GET', `${PANEL}/records/${id}`);
  if (response.status === 404) {
    return null;
  }
  return ((await response.json()) as { values: Record<string, unknown> })
    .values;
}

interface Price {
  currency: string;
  amount_minor: number;
  source: string;
  rate_used: number | null;
}

async function prices(variantId: string): Promise<Price[]> {
  const { results } = await db()
    .prepare(
      `SELECT currency, amount_minor, source, rate_used FROM p_shop_price
       WHERE variant_id = ? ORDER BY currency`,
    )
    .bind(variantId)
    .all<Price>();
  return results;
}

async function ledger(
  variantId: string,
): Promise<{ delta: number; reason: string }[]> {
  const { results } = await db()
    .prepare(
      `SELECT delta, reason FROM p_shop_stock_adjustment
       WHERE variant_id = ? ORDER BY created_at, rowid`,
    )
    .bind(variantId)
    .all<{ delta: number; reason: string }>();
  return results;
}

async function variantRow(id: string): Promise<Record<string, unknown> | null> {
  return db()
    .prepare('SELECT * FROM p_shop_variant WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>();
}

/** Puts a variant on an order, as a placed order's line does. */
async function order(variantId: string): Promise<void> {
  await db()
    .prepare(
      `INSERT INTO p_shop_order_line
         (id, order_id, variant_id, sku_snapshot, name_snapshot,
          unit_price_minor, quantity)
       VALUES (?, 'order-1', ?, 'SKU', 'Name', 100, 1)`,
    )
    .bind(`order-1:${variantId}`, variantId)
    .run();
}

/**
 * A context for calling a handler directly, with the purges it asks for and
 * the work it leaves running behind the answer.
 */
function context(over: Partial<PluginContext> = {}): {
  ctx: PluginContext;
  purged: string[][];
  background: Promise<unknown>[];
} {
  const purged: string[][] = [];
  const background: Promise<unknown>[] = [];
  return {
    purged,
    background,
    ctx: {
      db: db(),
      settings: {},
      purgeTags: async (tags: readonly string[]) => {
        purged.push([...tags]);
      },
      waitUntil: (work: Promise<unknown>) => {
        background.push(work);
      },
      ...over,
    } as unknown as PluginContext,
  };
}

function record(
  product: TestProduct,
  id: string | null,
  values: Record<string, unknown>,
): PluginRecordInput {
  return {
    id,
    values: {
      sku: 'D-1',
      options: {},
      status: 'active',
      moq: 1,
      stock_policy: 'track',
      stock: null,
      lead_time_min: null,
      lead_time_max: null,
      weight_grams: null,
      sort_order: 0,
      price: null,
      other_prices: [],
      ...values,
    },
    attachedTo: { translationGroup: product.translationGroup, kind: 'product' },
  };
}

describe('variants in the admin', () => {
  let screw: TestProduct;
  let bolt: TestProduct;

  beforeAll(async () => {
    await ensureSite();
    screw = await createProduct({ title: 'Cap screw', slug: 'records-screw' });
    bolt = await createProduct({ title: 'Flange bolt', slug: 'records-bolt' });
  });

  beforeEach(clearShopTables);

  describe('through Mallok’s API, as the form saves', () => {
    it('creates a variant of the product whose editor it was added in', async () => {
      const created = await create(screw, {
        sku: ' CS-10 ',
        options: { length: '10 mm' },
        moq: 100,
        stock: 500,
        lead_time_min: 5,
        lead_time_max: 10,
        weight_grams: 4,
        sort_order: 2,
        price: { amount: 185, currency: 'USD' },
      });

      expect(created.status).toBe(201);
      expect(await variantRow(created.id ?? '')).toMatchObject({
        product_group: screw.translationGroup,
        sku: 'CS-10',
        option_values: '{"length":"10 mm"}',
        moq: 100,
        stock: 500,
        stock_policy: 'track',
        status: 'active',
        lead_time_min: 5,
        lead_time_max: 10,
        weight_grams: 4,
        sort_order: 2,
      });
      expect(await prices(created.id ?? '')).toEqual([
        { currency: 'USD', amount_minor: 185, source: 'base', rate_used: null },
      ]);
    });

    it('lists a product’s variants under that product and no other', async () => {
      await create(screw, { sku: 'CS-10', moq: 1 });
      await create(screw, { sku: 'CS-16', moq: 1 });
      await create(bolt, { sku: 'FB-30', moq: 1 });

      const list = async (product: TestProduct): Promise<string[]> => {
        const response = await api(
          'GET',
          `${PANEL}?attached=${product.translationGroup}&sort=sku`,
        );
        const { rows } = (await response.json()) as { rows: { sku: string }[] };
        return rows.map((row) => row.sku);
      };

      expect(await list(screw)).toEqual(['CS-10', 'CS-16']);
      expect(await list(bolt)).toEqual(['FB-30']);
    });

    it('hands the form back what was saved, and saving that again changes nothing', async () => {
      await setRate('EUR', 0.92);
      const values = {
        sku: 'CS-10',
        options: { length: '10 mm', finish: 'Anodised' },
        status: 'active',
        moq: 100,
        stock_policy: 'track',
        stock: 500,
        lead_time_min: 5,
        lead_time_max: 10,
        weight_grams: null,
        sort_order: 0,
        price: { amount: 185, currency: 'USD' },
        other_prices: [{ price: { amount: 150, currency: 'GBP' } }],
      };
      const { id = '' } = await create(screw, values);

      const loaded = await load(id);
      // Everything but the stock: the form's field is for setting a figure,
      // and comes empty.
      expect(loaded).toEqual({ ...values, stock: null });

      // The rate moves, sixty are sold, and the form is saved untouched for
      // another reason.
      await setRate('EUR', 0.99);
      await db()
        .prepare('UPDATE p_shop_variant SET stock = 440 WHERE id = ?')
        .bind(id)
        .run();
      const before = { prices: await prices(id), ledger: await ledger(id) };
      const again = await update(screw, id, loaded ?? {});

      expect(again.status).toBe(200);
      // A derived price is not recomputed because someone pressed Save: only
      // a new base price, or a rate that has drifted, moves it.
      expect(await prices(id)).toEqual(before.prices);
      // And the sixty stay sold: the save wrote no stock and no ledger row.
      expect(await stockOf(id)).toBe(440);
      expect(await ledger(id)).toEqual(before.ledger);
      expect(await load(id)).toEqual({ ...values, stock: null });
    });

    it('refuses what Mallok can see is wrong before the shop is asked', async () => {
      const refused = await create(screw, {
        sku: 'CS-10',
        moq: 0,
        stock: -1,
        price: { amount: 1.5, currency: 'USD' },
        status: 'sold',
      });

      expect(refused.status).toBe(422);
      expect(Object.keys(refused.errors ?? {}).sort()).toEqual([
        'moq',
        'price',
        'status',
        'stock',
      ]);
      expect(await variantRow('CS-10')).toBeNull();
    });

    it('refuses a variant that belongs to no product', async () => {
      const orphan = await api('POST', `${PANEL}/records`, {
        values: { sku: 'CS-10', moq: 1 },
      });
      const stranger = await api('POST', `${PANEL}/records`, {
        attachedTo: 'no-such-group',
        values: { sku: 'CS-10', moq: 1 },
      });

      expect(orphan.status).toBe(400);
      expect(stranger.status).toBeGreaterThanOrEqual(400);
      const count = await db()
        .prepare('SELECT COUNT(*) AS n FROM p_shop_variant')
        .first<{ n: number }>();
      expect(count?.n).toBe(0);
    });

    it('refuses a SKU another variant has, on any product', async () => {
      await create(screw, { sku: 'CS-10', moq: 1 });

      const second = await create(bolt, { sku: 'CS-10', moq: 1 });

      expect(second.status).toBe(422);
      expect(second.errors).toEqual({
        sku: 'Another variant already has this SKU.',
      });
    });

    it('lets a variant keep its own SKU when it is saved again', async () => {
      const { id = '' } = await create(screw, { sku: 'CS-10', moq: 1 });

      expect((await update(screw, id, { sku: 'CS-10', moq: 5 })).status).toBe(
        200,
      );
      expect(await variantRow(id)).toMatchObject({ sku: 'CS-10', moq: 5 });
    });

    it.each([
      [{ lead_time_min: 5 }, 'lead_time_max'],
      [{ lead_time_max: 10 }, 'lead_time_min'],
      [{ lead_time_min: 10, lead_time_max: 5 }, 'lead_time_max'],
      [{ lead_time_min: 2.5, lead_time_max: 5 }, 'lead_time_min'],
      [{ moq: 2.5 }, 'moq'],
      [{ stock: 10.5 }, 'stock'],
      [{ weight_grams: 0.5 }, 'weight_grams'],
      [{ sort_order: 1.5 }, 'sort_order'],
    ])('refuses %o, naming %s', async (values, field) => {
      const refused = await create(screw, { sku: 'CS-10', moq: 1, ...values });

      expect(refused.status).toBe(422);
      expect(Object.keys(refused.errors ?? {})).toEqual([field]);
      const count = await db()
        .prepare('SELECT COUNT(*) AS n FROM p_shop_variant')
        .first<{ n: number }>();
      expect(count?.n).toBe(0);
    });

    it('refuses a minimum order no cart line could hold', async () => {
      const { ctx } = context();

      const atLimit = await saveVariant(
        record(screw, null, { sku: 'CS-A', moq: 10000 }),
        ctx,
      );
      const over = await saveVariant(
        record(screw, null, { sku: 'CS-B', moq: 10001 }),
        ctx,
      );

      expect(atLimit).toHaveProperty('id');
      expect(over).toEqual({
        errors: { moq: 'The minimum order can be at most 10000.' },
      });
    });

    it('refuses the same currency priced by hand twice, naming the row', async () => {
      const refused = await create(screw, {
        sku: 'CS-10',
        moq: 1,
        price: { amount: 185, currency: 'USD' },
        other_prices: [
          { price: { amount: 175, currency: 'EUR' } },
          { price: { amount: 170, currency: 'EUR' } },
        ],
      });

      expect(refused.status).toBe(422);
      expect(Object.keys(refused.errors ?? {})).toEqual([
        'other_prices.1.price',
      ]);
    });

    it('is not found once it has been deleted', async () => {
      const { id = '' } = await create(screw, { sku: 'CS-10', moq: 1 });

      const removed = await api('DELETE', `${PANEL}/records/${id}`);

      expect(removed.status).toBe(200);
      expect(await load(id)).toBeNull();
      expect((await update(screw, id, { sku: 'CS-10', moq: 1 })).status).toBe(
        422,
      );
      expect(await variantRow(id)).toBeNull();
    });
  });

  describe('prices', () => {
    it('derives the other currencies from the base price, at the stored rates', async () => {
      await setRate('EUR', 0.92);
      await setRate('GBP', 0.79);

      const { id = '' } = await create(screw, {
        sku: 'CS-10',
        moq: 1,
        price: { amount: 9900, currency: 'USD' },
      });

      // 9900 * 0.92 = 9108; * 1.03 = 9381; up to the next .99 = 9399.
      // 9900 * 0.79 = 7821; * 1.03 = 8056; up to the next .99 = 8099.
      expect(await prices(id)).toEqual([
        {
          currency: 'EUR',
          amount_minor: 9399,
          source: 'auto',
          rate_used: 0.92,
        },
        {
          currency: 'GBP',
          amount_minor: 8099,
          source: 'auto',
          rate_used: 0.79,
        },
        {
          currency: 'USD',
          amount_minor: 9900,
          source: 'base',
          rate_used: null,
        },
      ]);
    });

    it('derives nothing for a currency it has no rate for', async () => {
      await setRate('EUR', 0.92);

      const { id = '' } = await create(screw, {
        sku: 'CS-10',
        moq: 1,
        price: { amount: 9900, currency: 'USD' },
      });

      expect((await prices(id)).map((row) => row.currency)).toEqual([
        'EUR',
        'USD',
      ]);
    });

    it('derives them again when the base price changes', async () => {
      await setRate('EUR', 0.92);
      const { id = '' } = await create(screw, {
        sku: 'CS-10',
        moq: 1,
        price: { amount: 9900, currency: 'USD' },
      });
      // The rate has moved a little since: the new price is computed at the
      // rate of the day it is entered.
      await setRate('EUR', 0.93);

      await update(screw, id, {
        sku: 'CS-10',
        moq: 1,
        price: { amount: 20000, currency: 'USD' },
      });

      // 20000 * 0.93 = 18600; * 1.03 = 19158; up to the next .99 = 19199.
      expect(await priceOf(id, 'EUR')).toEqual({
        amount_minor: 19199,
        source: 'auto',
        rate_used: 0.93,
      });
    });

    it('stores a price entered by hand as manual, in place of the derived one', async () => {
      await setRate('EUR', 0.92);
      await setRate('GBP', 0.79);
      const { id = '' } = await create(screw, {
        sku: 'CS-10',
        moq: 1,
        price: { amount: 9900, currency: 'USD' },
      });

      await update(screw, id, {
        sku: 'CS-10',
        moq: 1,
        price: { amount: 9900, currency: 'USD' },
        other_prices: [{ price: { amount: 8500, currency: 'EUR' } }],
      });

      expect(await priceOf(id, 'EUR')).toEqual({
        amount_minor: 8500,
        source: 'manual',
        rate_used: null,
      });
      // The currency not entered by hand is still derived, and untouched.
      expect(await priceOf(id, 'GBP')).toMatchObject({
        amount_minor: 8099,
        source: 'auto',
      });
    });

    it('goes back to deriving a currency whose hand-entered price is taken off', async () => {
      await setRate('EUR', 0.92);
      const { id = '' } = await create(screw, {
        sku: 'CS-10',
        moq: 1,
        price: { amount: 9900, currency: 'USD' },
        other_prices: [{ price: { amount: 8500, currency: 'EUR' } }],
      });

      await update(screw, id, {
        sku: 'CS-10',
        moq: 1,
        price: { amount: 9900, currency: 'USD' },
        other_prices: [],
      });

      expect(await priceOf(id, 'EUR')).toEqual({
        amount_minor: 9399,
        source: 'auto',
        rate_used: 0.92,
      });
    });

    it('drops a hand-entered price taken off the form when there is no rate to derive one from', async () => {
      const { id = '' } = await create(screw, {
        sku: 'CS-10',
        moq: 1,
        price: { amount: 9900, currency: 'USD' },
        other_prices: [{ price: { amount: 8500, currency: 'EUR' } }],
      });

      await update(screw, id, {
        sku: 'CS-10',
        moq: 1,
        price: { amount: 9900, currency: 'USD' },
      });

      expect(await priceOf(id, 'EUR')).toBeNull();
    });

    it('leaves a variant with no price at all when the base price is taken off', async () => {
      await setRate('EUR', 0.92);
      const { id = '' } = await create(screw, {
        sku: 'CS-10',
        moq: 1,
        price: { amount: 9900, currency: 'USD' },
      });
      expect(await prices(id)).toHaveLength(2);

      await update(screw, id, { sku: 'CS-10', moq: 1, price: null });

      // Quoted on request: nothing left that was derived from a price that
      // is no longer there.
      expect(await prices(id)).toEqual([]);
    });

    it('refuses a price in another currency without a base price', async () => {
      // A variant priced only in euros would leave its page with no currency
      // every size shares, and so with no prices at all.
      const refused = await create(screw, {
        sku: 'CS-10',
        moq: 1,
        other_prices: [{ price: { amount: 8500, currency: 'EUR' } }],
      });

      expect(refused.status).toBe(422);
      expect(Object.keys(refused.errors ?? {})).toEqual(['price']);
      expect(await variantRow('CS-10')).toBeNull();
    });

    it('refuses a price of nothing', async () => {
      const { ctx } = context();

      const free = await saveVariant(
        record(screw, null, { price: { amount: 0, currency: 'USD' } }),
        ctx,
      );
      const freeAbroad = await saveVariant(
        record(screw, null, {
          price: { amount: 100, currency: 'USD' },
          other_prices: [{ price: { amount: 0, currency: 'EUR' } }],
        }),
        ctx,
      );

      expect(Object.keys((free as { errors: object }).errors)).toEqual([
        'price',
      ]);
      expect(Object.keys((freeAbroad as { errors: object }).errors)).toEqual([
        'other_prices.0.price',
      ]);
    });

    it('keeps a derived price in step with the base price when two saves cross', async () => {
      await setRate('EUR', 0.92);
      const { id = '' } = await create(screw, {
        sku: 'CS-10',
        moq: 1,
        price: { amount: 10000, currency: 'USD' },
      });
      // One seller saves the form as it was opened, with only the minimum
      // order changed. Between that save's reading and its write, another
      // doubles the base price.
      const { ctx } = context({
        db: interceptBatches({
          before: async (index) => {
            if (index === 1) {
              await update(screw, id, {
                sku: 'CS-10',
                moq: 1,
                price: { amount: 20000, currency: 'USD' },
              });
            }
          },
        }),
      });

      await saveVariant(
        record(screw, id, {
          sku: 'CS-10',
          moq: 5,
          price: { amount: 10000, currency: 'USD' },
        }),
        ctx,
      );

      // The later write wins the base price. Whichever does, the euro price
      // is the one derived from it: 10000 * 0.92 = 9200; * 1.03 = 9476; up
      // to the next .99 = 9499. Not 18999, left over from the price that
      // was overwritten.
      expect(await priceOf(id, 'USD')).toMatchObject({ amount_minor: 10000 });
      expect(await priceOf(id, 'EUR')).toEqual({
        amount_minor: 9499,
        source: 'auto',
        rate_used: 0.92,
      });
    });

    it('refuses a base price in another currency, and the base currency among the hand-entered ones', async () => {
      const { ctx } = context();

      expect(
        await saveVariant(
          record(screw, null, { price: { amount: 100, currency: 'EUR' } }),
          ctx,
        ),
      ).toMatchObject({ errors: { price: expect.stringContaining('in USD') } });
      expect(
        await saveVariant(
          record(screw, null, {
            price: { amount: 100, currency: 'USD' },
            other_prices: [{ price: { amount: 90, currency: 'USD' } }],
          }),
          ctx,
        ),
      ).toEqual({
        errors: { 'other_prices.0.price': 'USD is the base price, above.' },
      });
    });
  });

  describe('stock', () => {
    it('records the stock a new variant starts with', async () => {
      const { id = '' } = await create(screw, {
        sku: 'CS-10',
        moq: 1,
        stock: 500,
      });
      const none = await create(screw, { sku: 'CS-16', moq: 1, stock: 0 });

      expect(await ledger(id)).toEqual([{ delta: 500, reason: 'manual' }]);
      // Nothing moved: a row with a difference of zero says nothing.
      expect(await ledger(none.id ?? '')).toEqual([]);
    });

    it('records the difference when a figure is set, and nothing when it is the same', async () => {
      const { id = '' } = await create(screw, {
        sku: 'CS-10',
        moq: 1,
        stock: 500,
      });

      await update(screw, id, { sku: 'CS-10', moq: 1, stock: 420 });
      await update(screw, id, { sku: 'CS-10', moq: 1, stock: 420 });
      await update(screw, id, { sku: 'CS-10', moq: 1, stock: 450 });

      expect(await stockOf(id)).toBe(450);
      expect(await ledger(id)).toEqual([
        { delta: 500, reason: 'manual' },
        { delta: -80, reason: 'manual' },
        { delta: 30, reason: 'manual' },
      ]);
    });

    it('leaves the stock alone when the field is empty, whatever has happened to it since', async () => {
      const { id = '' } = await create(screw, {
        sku: 'CS-10',
        moq: 1,
        stock: 500,
      });
      // Sixty are sold while the seller has the form open to change a lead
      // time. The form never held the 500, so it cannot put them back.
      const { ctx } = context({
        db: interceptBatches({
          before: async (index) => {
            if (index === 1) {
              await db()
                .prepare('UPDATE p_shop_variant SET stock = 440 WHERE id = ?')
                .bind(id)
                .run();
            }
          },
        }),
      });

      await saveVariant(
        record(screw, id, {
          sku: 'CS-10',
          lead_time_min: 5,
          lead_time_max: 10,
        }),
        ctx,
      );

      expect(await stockOf(id)).toBe(440);
      expect(await ledger(id)).toEqual([{ delta: 500, reason: 'manual' }]);
      expect(await variantRow(id)).toMatchObject({ lead_time_min: 5 });
    });

    it('starts a new variant with none when the field is empty, and can set a stock to none', async () => {
      const { id = '' } = await create(screw, { sku: 'CS-10', moq: 1 });
      expect(await stockOf(id)).toBe(0);
      expect(await ledger(id)).toEqual([]);

      await update(screw, id, { sku: 'CS-10', moq: 1, stock: 30 });
      // Nought is a figure, not an empty field.
      await update(screw, id, { sku: 'CS-10', moq: 1, stock: 0 });

      expect(await stockOf(id)).toBe(0);
      expect(await ledger(id)).toEqual([
        { delta: 30, reason: 'manual' },
        { delta: -30, reason: 'manual' },
      ]);
    });

    it('measures the difference from the stock as it is when the save lands, not when the form was opened', async () => {
      const { id = '' } = await create(screw, {
        sku: 'CS-10',
        moq: 1,
        stock: 500,
      });
      // A payment takes 60 between the seller opening the form and saving.
      const { ctx } = context({
        db: interceptBatches({
          before: async (index) => {
            if (index === 1) {
              await db()
                .prepare('UPDATE p_shop_variant SET stock = 440 WHERE id = ?')
                .bind(id)
                .run();
            }
          },
        }),
      });

      await saveVariant(record(screw, id, { sku: 'CS-10', stock: 520 }), ctx);

      // The figure the seller set stands, and the ledger says what it took
      // to get there from what was really in the table: 440, not 500.
      expect(await stockOf(id)).toBe(520);
      expect((await ledger(id)).at(-1)).toEqual({
        delta: 80,
        reason: 'manual',
      });
    });
  });

  describe('a save, seen from inside', () => {
    it('purges the pages of the product the variant belongs to, once', async () => {
      const { ctx, purged } = context();

      const created = await saveVariant(
        record(screw, null, { sku: 'CS-10' }),
        ctx,
      );

      expect(created).toHaveProperty('id');
      expect(purged).toEqual([[screw.translationGroup]]);
    });

    it('purges nothing when it refuses', async () => {
      const { ctx, purged } = context();

      const refused = await saveVariant(
        record(screw, null, { sku: '  ' }),
        ctx,
      );

      expect(refused).toEqual({ errors: { sku: 'A variant needs a SKU.' } });
      expect(purged).toEqual([]);
    });

    it('does not wait for the purge before it answers', async () => {
      // Mallok gathers two seconds of purges into one call; a save that
      // waited would take those two seconds every time.
      let finish: () => void = () => {};
      const { ctx, background } = context({
        purgeTags: () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      });

      const created = await saveVariant(
        record(screw, null, { sku: 'CS-10' }),
        ctx,
      );

      // Answered while the purge is still out, and the purge handed to the
      // runtime to keep alive.
      expect(created).toHaveProperty('id');
      expect(background).toHaveLength(1);
      finish();
      await Promise.all(background);
    });

    it.each([
      [
        'is refused',
        async () => {
          throw new Error('The purge service is down.');
        },
      ],
      [
        'cannot even be asked for',
        () => {
          throw new Error('No purge here.');
        },
      ],
    ])('is saved when the purge %s', async (_how, purgeTags) => {
      const { ctx, background } = context({
        purgeTags: purgeTags as PluginContext['purgeTags'],
      });

      const created = await saveVariant(
        record(screw, null, { sku: 'CS-10' }),
        ctx,
      );

      expect(created).toHaveProperty('id');
      expect(await variantRow((created as { id: string }).id)).toMatchObject({
        sku: 'CS-10',
      });
      // Nothing left behind that rejects: the failure was dealt with.
      await expect(Promise.all(background)).resolves.toBeDefined();
    });

    it('reads once and writes once', async () => {
      await setRate('EUR', 0.92);
      let batches = 0;
      const { ctx } = context({
        db: interceptBatches({
          before: () => {
            batches += 1;
          },
        }),
      });

      await saveVariant(
        record(screw, null, {
          sku: 'CS-10',
          stock: 5,
          price: { amount: 100, currency: 'USD' },
          other_prices: [{ price: { amount: 80, currency: 'GBP' } }],
        }),
        ctx,
      );

      expect(batches).toBe(2);
    });

    it('says the SKU is taken when another variant took it between the reading and the write', async () => {
      const { ctx, purged } = context({
        db: interceptBatches({
          before: async (index) => {
            if (index === 1) {
              await create(bolt, { sku: 'CS-10', moq: 1 });
            }
          },
        }),
      });

      const lost = await saveVariant(
        record(screw, null, { sku: 'CS-10' }),
        ctx,
      );

      expect(lost).toEqual({
        errors: { sku: 'Another variant already has this SKU.' },
      });
      expect(purged).toEqual([]);
      const mine = await db()
        .prepare(
          'SELECT COUNT(*) AS n FROM p_shop_variant WHERE product_group = ?',
        )
        .bind(screw.translationGroup)
        .first<{ n: number }>();
      expect(mine?.n).toBe(0);
    });

    it('refuses to move a variant to another product', async () => {
      const { ctx } = context();
      const created = (await saveVariant(
        record(screw, null, { sku: 'CS-10' }),
        ctx,
      )) as { id: string };

      const moved = await saveVariant(
        record(bolt, created.id, { sku: 'CS-10' }),
        ctx,
      );

      expect(moved).toEqual({
        errors: { sku: 'This variant belongs to another product.' },
      });
      expect(await variantRow(created.id)).toMatchObject({
        product_group: screw.translationGroup,
      });
    });

    it('loads nothing for a variant that is not there', async () => {
      expect(await loadVariant('no-such-variant', context().ctx)).toBeNull();
    });
  });

  describe('archiving a variant', () => {
    it('takes it out of every cart, and leaves the other lines', async () => {
      const { id = '' } = await create(screw, { sku: 'CS-10', moq: 1 });
      const other = await create(screw, { sku: 'CS-16', moq: 1 });
      await db().batch([
        db().prepare(
          `INSERT INTO p_shop_cart (id, created_at, updated_at, expires_at)
           VALUES ('cart-1', 'now', 'now', '2999-01-01T00:00:00.000Z')`,
        ),
        db()
          .prepare(
            "INSERT INTO p_shop_cart_line (cart_id, variant_id, quantity) VALUES ('cart-1', ?, 1), ('cart-1', ?, 1)",
          )
          .bind(id, other.id ?? ''),
      ]);

      await update(screw, id, { sku: 'CS-10', moq: 1, status: 'archived' });

      const left = await db()
        .prepare('SELECT variant_id FROM p_shop_cart_line')
        .all<{ variant_id: string }>();
      expect(left.results.map((row) => row.variant_id)).toEqual([other.id]);
      expect(await variantRow(id)).toMatchObject({ status: 'archived' });
    });

    it('leaves carts alone when a variant is saved active', async () => {
      const { id = '' } = await create(screw, { sku: 'CS-10', moq: 1 });
      await db().batch([
        db().prepare(
          `INSERT INTO p_shop_cart (id, created_at, updated_at, expires_at)
           VALUES ('cart-1', 'now', 'now', '2999-01-01T00:00:00.000Z')`,
        ),
        db()
          .prepare(
            "INSERT INTO p_shop_cart_line (cart_id, variant_id, quantity) VALUES ('cart-1', ?, 1)",
          )
          .bind(id),
      ]);

      await update(screw, id, { sku: 'CS-10', moq: 2 });

      const left = await db()
        .prepare('SELECT COUNT(*) AS n FROM p_shop_cart_line')
        .first<{ n: number }>();
      expect(left?.n).toBe(1);
    });
  });

  describe('what a purge answers', () => {
    // Mallok's `purgeTags` resolves, rather than rejects, when a purge does
    // not happen. A handler that only caught a rejection would never know.
    async function logged(answer: unknown): Promise<string[]> {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        const { ctx, background } = context({
          purgeTags: async () => answer,
        });
        const created = await saveVariant(
          record(screw, null, { sku: `CS-${crypto.randomUUID()}` }),
          ctx,
        );
        expect(created).toHaveProperty('id');
        await Promise.all(background);
        return log.mock.calls.map((call) => String(call[0]));
      } finally {
        log.mockRestore();
      }
    }

    it('is noted when Cloudflare turned the purge down', async () => {
      expect(
        await logged({ attempted: true, ok: false, detail: '429' }),
      ).toEqual(['{"event":"shop_purge_failed","reason":"refused"}']);
    });

    it('is not a failure on a site that has nothing to purge with', async () => {
      // Every save on such a site would log one otherwise.
      expect(await logged({ attempted: false, ok: false })).toEqual([]);
    });

    it('is taken at its word when it says the purge was done, or says nothing', async () => {
      expect(await logged({ attempted: true, ok: true })).toEqual([]);
      expect(await logged(undefined)).toEqual([]);
    });
  });

  describe('deleting a variant', () => {
    it('takes it, its prices and its place in every cart away, and purges its product', async () => {
      const { ctx, purged } = context();
      const { id = '' } = await create(screw, {
        sku: 'CS-10',
        moq: 1,
        price: { amount: 100, currency: 'USD' },
      });
      await db().batch([
        db().prepare(
          `INSERT INTO p_shop_cart (id, created_at, updated_at, expires_at)
             VALUES ('cart-1', 'now', 'now', '2999-01-01T00:00:00.000Z')`,
        ),
        db()
          .prepare(
            "INSERT INTO p_shop_cart_line (cart_id, variant_id, quantity) VALUES ('cart-1', ?, 1)",
          )
          .bind(id),
      ]);

      await removeVariant(id, ctx);

      expect(await variantRow(id)).toBeNull();
      expect(await prices(id)).toEqual([]);
      const inCarts = await db()
        .prepare(
          'SELECT COUNT(*) AS n FROM p_shop_cart_line WHERE variant_id = ?',
        )
        .bind(id)
        .first<{ n: number }>();
      expect(inCarts?.n).toBe(0);
      expect(purged).toEqual([[screw.translationGroup]]);
    });

    it('archives one that has been ordered instead, and keeps its prices', async () => {
      const { ctx } = context();
      const { id = '' } = await create(screw, {
        sku: 'CS-10',
        moq: 1,
        price: { amount: 100, currency: 'USD' },
      });
      await order(id);

      await removeVariant(id, ctx);

      // An order's lines and the stock ledger still name it.
      expect(await variantRow(id)).toMatchObject({
        sku: 'CS-10',
        status: 'archived',
      });
      expect(await prices(id)).toHaveLength(1);
    });

    it('does nothing, and purges nothing, for a variant that is not there', async () => {
      const { ctx, purged } = context();

      await removeVariant('no-such-variant', ctx);

      expect(purged).toEqual([]);
    });
  });

  describe('when a product is deleted', () => {
    const ref = (product: TestProduct, lastInGroup: boolean) => ({
      id: product.id,
      kind: 'product',
      locale: 'en',
      translationGroup: product.translationGroup,
      lastInGroup,
    });

    it('removes the variants of a product whose last language has gone, and archives the ones on an order', async () => {
      const { ctx, purged } = context();
      const fresh = await create(screw, {
        sku: 'CS-10',
        moq: 1,
        price: { amount: 100, currency: 'USD' },
      });
      const sold = await create(screw, {
        sku: 'CS-16',
        moq: 1,
        price: { amount: 120, currency: 'USD' },
      });
      const other = await create(bolt, { sku: 'FB-30', moq: 1 });
      await order(sold.id ?? '');

      await onProductDeleted(ref(screw, true), ctx);

      expect(await variantRow(fresh.id ?? '')).toBeNull();
      expect(await prices(fresh.id ?? '')).toEqual([]);
      // Kept, because an order names it — and nobody can open it any more,
      // so it gives its SKU back for another product's variant to take.
      expect(await variantRow(sold.id ?? '')).toMatchObject({
        status: 'archived',
        sku: `CS-16#${sold.id}`,
      });
      expect(await prices(sold.id ?? '')).toHaveLength(1);
      expect((await create(bolt, { sku: 'CS-16', moq: 1 })).status).toBe(201);
      // Another product's variants are not this one's business.
      expect(await variantRow(other.id ?? '')).toMatchObject({
        status: 'active',
      });
      expect(purged).toEqual([[screw.translationGroup]]);
    });

    it('can be run again and changes nothing more', async () => {
      const { ctx } = context();
      const sold = await create(screw, { sku: 'CS-16', moq: 1 });
      await order(sold.id ?? '');
      await onProductDeleted(ref(screw, true), ctx);
      const first = await variantRow(sold.id ?? '');

      await onProductDeleted(ref(screw, true), ctx, new Date('2030-01-01'));

      expect(await variantRow(sold.id ?? '')).toEqual(first);
    });

    it('leaves the variants alone while another language of the product is left', async () => {
      const { ctx, purged } = context();
      const { id = '' } = await create(screw, { sku: 'CS-10', moq: 1 });

      await onProductDeleted(ref(screw, false), ctx);

      expect(await variantRow(id)).toMatchObject({ status: 'active' });
      expect(purged).toEqual([]);
    });

    it('is nothing to do with the shop when what was deleted is not a product', async () => {
      const { ctx, purged } = context();
      const { id = '' } = await create(screw, { sku: 'CS-10', moq: 1 });

      await onProductDeleted({ ...ref(screw, true), kind: 'collection' }, ctx);

      expect(await variantRow(id)).toMatchObject({ status: 'active' });
      expect(purged).toEqual([]);
    });

    it('is called by Mallok when the content is deleted through its API', async () => {
      const doomed = await createContent({
        kind: 'product',
        title: 'Doomed part',
        slug: 'records-doomed',
      });
      const german = await createContent({
        kind: 'product',
        title: 'Verlorenes Teil',
        slug: 'records-verloren',
        locale: 'de',
        translationGroup: doomed.translationGroup,
      });
      const { id = '' } = await create(doomed, { sku: 'DP-1', moq: 1 });

      // One language of two: the product is still there.
      const first = await api('DELETE', `/_mallok/api/content/${german.id}`);
      expect(first.status).toBe(200);
      expect(await variantRow(id)).not.toBeNull();

      const last = await api('DELETE', `/_mallok/api/content/${doomed.id}`);
      expect(last.status).toBe(200);
      expect(await last.json()).not.toHaveProperty('hookFailed');
      expect(await variantRow(id)).toBeNull();
    });
  });
});
