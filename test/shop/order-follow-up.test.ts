import type { EmailMessage } from 'mallok/worker';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { priceCart } from '../../src/plugins/shop/lib/cart-pricing.js';
import {
  existingOrderLinkKey,
  orderToken,
} from '../../src/plugins/shop/lib/order-access.js';
import {
  type FollowUpContext,
  followUpJob,
  runFollowUps,
} from '../../src/plugins/shop/lib/order-follow-up.js';
import {
  cancelOrder,
  fulfilOversold,
  refundOrder,
  shipOrder,
} from '../../src/plugins/shop/lib/order-fulfilment.js';
import {
  createPendingOrder,
  markOrderPaid,
} from '../../src/plugins/shop/lib/orders.js';
import {
  atTheSameMoment,
  clearShopTables,
  createProduct,
  createVariant,
  db,
  ensureSite,
  outboxRows,
  setPrice,
  setStock,
  type TestProduct,
} from './helpers.js';

const NOW = new Date('2026-10-31T08:00:00.000Z');
const LATER = new Date('2026-10-31T08:01:00.000Z');
const SELLER = 'sales@seller.example';
const BUYER = 'ada@buyer.example';

let bolt: TestProduct;

/** Mallok's context, recording every email and purge handed to it. */
function context(
  options: {
    seller?: string | null;
    failOn?: (message: EmailMessage) => boolean;
  } = {},
): {
  ctx: FollowUpContext;
  sent: EmailMessage[];
  purged: string[][];
} {
  const sent: EmailMessage[] = [];
  const purged: string[][] = [];
  const seller = options.seller === undefined ? SELLER : options.seller;
  return {
    sent,
    purged,
    ctx: {
      db: db(),
      settings: seller === null ? {} : { inquiry_recipient: seller },
      site: { defaultLocale: 'en' },
      sendEmail: async (message) => {
        if (options.failOn?.(message) === true) {
          throw new Error('The email queue is unreachable');
        }
        sent.push(message);
        return `job-${sent.length}`;
      },
      purgeTags: async (tags) => {
        purged.push([...tags]);
        return { attempted: true, ok: true };
      },
    },
  };
}

async function order(
  options: { locale?: string; origin?: string } = {},
): Promise<{ id: string; orderNo: string }> {
  const cart = await priceCart(db(), {
    lines: [{ variantId: 'hb-m8', quantity: 100 }],
    locale: options.locale ?? 'en',
    defaultLocale: 'en',
    currency: 'USD',
  });
  if (!cart.ok) {
    throw new Error('The fixture cart did not price');
  }
  return createPendingOrder(db(), {
    cart,
    locale: options.locale ?? 'en',
    email: BUYER,
    shippingAddress: {
      recipient: 'Ada Lovelace',
      line1: 'Hafenstraße 1',
      city: 'Hamburg',
      postalCode: '20457',
      country: 'DE',
    },
    shippingMinor: 4900,
    company: 'Analytical Engines Ltd',
    shippingZone: 'Europe',
    siteOrigin: options.origin ?? 'https://shop.example',
    now: NOW,
  });
}

async function pay(orderId: string): Promise<void> {
  await markOrderPaid(db(), {
    orderId,
    eventId: `evt_${orderId}`,
    paymentIntentId: `pi_${orderId}`,
    now: NOW,
  });
}

async function handled(): Promise<(string | null)[]> {
  return (await outboxRows()).map((row) => row.handled_at);
}

beforeAll(async () => {
  await ensureSite();
  bolt = await createProduct({ title: 'Hex bolt M8', slug: 'follow-up-bolt' });
});

beforeEach(async () => {
  await clearShopTables();
  await createVariant({
    id: 'hb-m8',
    productGroup: bolt.translationGroup,
    sku: 'HB-M8',
    moq: 10,
    stock: 1000,
  });
  await setPrice({
    variantId: 'hb-m8',
    currency: 'USD',
    amountMinor: 990,
    source: 'base',
  });
});

describe('what a paid order owes', () => {
  it('is the buyer’s confirmation with their link, the seller’s notice, and a purge', async () => {
    const placed = await order();
    await pay(placed.id);
    const { ctx, sent, purged } = context();

    const outcome = await runFollowUps(ctx, { now: LATER, limit: 10 });

    expect(outcome).toEqual({ handled: 1, failed: 0 });
    expect(sent.map((message) => [message.to, message.subject])).toEqual([
      [BUYER, `Order ${placed.orderNo} confirmed`],
      [SELLER, `New order ${placed.orderNo} — $1,039.00`],
    ]);
    expect(sent[1]?.replyTo).toBe(BUYER);
    const key = await existingOrderLinkKey(db());
    const token = key === null ? '' : await orderToken(key, placed.id);
    expect(sent[0]?.text).toContain(
      `https://shop.example/_mallok/p/shop/order/${placed.orderNo}?k=${token}`,
    );
    expect(sent[0]?.text).toContain('Shipping: $49.00');
    // The plugin's own tag for the product; Mallok prefixes it on the page.
    expect(purged).toEqual([[bolt.translationGroup]]);
    expect(await handled()).toEqual([LATER.toISOString()]);
  });

  it('tells no seller when the shop has nowhere to tell them', async () => {
    const placed = await order();
    await pay(placed.id);
    const { ctx, sent } = context({ seller: null });

    await runFollowUps(ctx, { now: LATER, limit: 10 });

    expect(sent.map((message) => message.to)).toEqual([BUYER]);
  });

  it('writes to the buyer in the language the order was placed in', async () => {
    const placed = await order({ locale: 'de' });
    await pay(placed.id);
    const { ctx, sent } = context();

    await runFollowUps(ctx, { now: LATER, limit: 10 });

    expect(sent[0]?.subject).toBe(`Bestellung ${placed.orderNo} bestätigt`);
    expect(sent[0]?.text).toContain(
      `/_mallok/p/shop/de/order/${placed.orderNo}`,
    );
    // The seller reads English.
    expect(sent[1]?.subject).toMatch(/^New order /);
  });
});

describe('what the rest of an order’s life owes', () => {
  it('tells the buyer it shipped, by whom and under which number', async () => {
    const placed = await order();
    await pay(placed.id);
    await shipOrder(db(), {
      orderId: placed.id,
      trackingNo: '1Z999',
      carrier: 'UPS',
      now: NOW,
    });
    const { ctx, sent } = context();

    await runFollowUps(ctx, { now: LATER, limit: 10 });

    const shipped = sent.find((message) => message.subject.includes('shipped'));
    expect(shipped?.to).toBe(BUYER);
    expect(shipped?.text).toContain('Carrier: UPS');
    expect(shipped?.text).toContain('Tracking number: 1Z999');
  });

  it('tells the buyer of a refund, for its amount, and purges the pages the stock came back to', async () => {
    const placed = await order();
    await pay(placed.id);
    await refundOrder(db(), { orderId: placed.id, now: NOW });
    const { ctx, sent, purged } = context();

    await runFollowUps(ctx, { now: LATER, limit: 10 });

    const refund = sent.find((message) => message.subject.includes('refunded'));
    expect(refund?.text).toContain('We have refunded $1,039.00');
    expect(purged).toHaveLength(2);
  });

  it('tells the buyer of a cancellation only when the seller made it', async () => {
    const bySeller = await order();
    const lapsed = await order();
    const replaced = await order();
    await cancelOrder(db(), {
      orderId: bySeller.id,
      reason: 'seller',
      now: NOW,
    });
    await cancelOrder(db(), {
      orderId: lapsed.id,
      reason: 'expired',
      now: NOW,
    });
    await cancelOrder(db(), {
      orderId: replaced.id,
      reason: 'replaced',
      now: NOW,
    });
    const { ctx, sent } = context();

    const outcome = await runFollowUps(ctx, { now: LATER, limit: 10 });

    expect(outcome.handled).toBe(3);
    expect(sent.map((message) => message.subject)).toEqual([
      `Order ${bySeller.orderNo} cancelled`,
    ]);
  });

  it('asks the seller to refund or restock an oversold order, and says nothing to the buyer yet', async () => {
    const placed = await order();
    await setStock('hb-m8', 0);
    await pay(placed.id);
    const { ctx, sent } = context();

    await runFollowUps(ctx, { now: LATER, limit: 10 });

    expect(sent.map((message) => [message.to, message.subject])).toEqual([
      [SELLER, `Order ${placed.orderNo} was paid for, and the stock had gone`],
    ]);
  });

  it('confirms an oversold order to its buyer once restocked, without telling the seller again', async () => {
    const placed = await order();
    await setStock('hb-m8', 0);
    await pay(placed.id);
    await runFollowUps(context().ctx, { now: LATER, limit: 10 });
    await setStock('hb-m8', 500);
    await fulfilOversold(db(), { orderId: placed.id, now: LATER });
    const { ctx, sent } = context();

    await runFollowUps(ctx, { now: LATER, limit: 10 });

    expect(sent.map((message) => message.to)).toEqual([BUYER]);
    expect(sent[0]?.subject).toBe(`Order ${placed.orderNo} confirmed`);
  });

  it.each([
    [
      'a cancelled order',
      async (id: string) => {
        await cancelOrder(db(), { orderId: id, now: NOW });
      },
      'the order had been cancelled',
    ],
    [
      'an order another payment settled',
      async (id: string) => {
        await pay(id);
      },
      'another payment had already settled the order',
    ],
  ])(
    'asks the seller to refund a payment for %s, and says why',
    async (_what, before, reason) => {
      const placed = await order();
      await before(placed.id);
      await markOrderPaid(db(), {
        orderId: placed.id,
        eventId: 'evt_late',
        paymentIntentId: 'pi_late',
        now: NOW,
      });
      const { ctx, sent } = context();

      await runFollowUps(ctx, { now: LATER, limit: 10 });

      const owed = sent.find((message) => message.subject.includes('refunded'));
      expect(owed?.to).toBe(SELLER);
      expect(owed?.text).toContain(reason);
      expect(owed?.text).toContain('pi_late');
    },
  );

  it('asks the seller to refund a payment that did not come to the total, and says so', async () => {
    const placed = await order();
    await markOrderPaid(db(), {
      orderId: placed.id,
      eventId: 'evt_short',
      paymentIntentId: 'pi_short',
      amountMinor: 1,
      currency: 'usd',
      now: NOW,
    });
    const { ctx, sent } = context();

    await runFollowUps(ctx, { now: LATER, limit: 10 });

    expect(sent[0]?.text).toContain("did not come to the order's total");
  });
});

describe('carrying the rows out', () => {
  it('sends each email once when two runners meet over the same rows', async () => {
    const placed = await order();
    await pay(placed.id);
    const { ctx, sent } = context();

    await atTheSameMoment([
      (database) =>
        runFollowUps({ ...ctx, db: database }, { now: LATER, limit: 10 }),
      (database) =>
        runFollowUps({ ...ctx, db: database }, { now: LATER, limit: 10 }),
    ]);

    expect(sent.map((message) => message.to)).toEqual([BUYER, SELLER]);
  });

  it('lets a row go when what it owes fails, and holds that order’s later rows back', async () => {
    const placed = await order();
    await pay(placed.id);
    await shipOrder(db(), { orderId: placed.id, trackingNo: 'T-1', now: NOW });
    const failing = context({
      failOn: (message) => message.subject.includes('confirmed'),
    });

    const outcome = await runFollowUps(failing.ctx, { now: LATER, limit: 10 });

    expect(outcome).toEqual({ handled: 0, failed: 1 });
    // "Shipped" did not overtake "confirmed".
    expect(failing.sent).toEqual([]);
    expect(await handled()).toEqual([null, null]);
    const claims = await db()
      .prepare('SELECT claimed_at FROM p_shop_outbox')
      .all<{ claimed_at: string | null }>();
    expect(claims.results.every((row) => row.claimed_at === null)).toBe(true);

    // The next run finds both, in order.
    const { ctx, sent } = context();
    await runFollowUps(ctx, { now: LATER, limit: 10 });
    expect(sent.map((message) => message.subject)).toEqual([
      `Order ${placed.orderNo} confirmed`,
      `New order ${placed.orderNo} — $1,039.00`,
      `Order ${placed.orderNo} has shipped`,
    ]);
  });

  it('leaves a row another runner has in hand, until its claim is ten minutes old', async () => {
    const placed = await order();
    await pay(placed.id);
    await db()
      .prepare('UPDATE p_shop_outbox SET claimed_at = ?')
      .bind(NOW.toISOString())
      .run();
    const { ctx, sent } = context();

    await runFollowUps(ctx, { now: LATER, limit: 10 });
    expect(sent).toEqual([]);

    await runFollowUps(ctx, {
      now: new Date(NOW.getTime() + 10 * 60 * 1000),
      limit: 10,
    });
    expect(sent).toHaveLength(2);
  });

  it('leaves out rows newer than the cron is told to take', async () => {
    const placed = await order();
    await pay(placed.id);
    const { ctx, sent } = context();

    await runFollowUps(ctx, {
      now: LATER,
      limit: 10,
      committedBefore: new Date(NOW.getTime() - 1),
    });

    expect(sent).toEqual([]);
  });

  it('is a job that throws when a row failed, so that Mallok tries again', async () => {
    const placed = await order();
    await pay(placed.id);
    const failing = context({ failOn: () => true });

    await expect(
      followUpJob({ orderId: placed.id }, failing.ctx, LATER),
    ).rejects.toThrow(/failed/);
    const { ctx, sent } = context();
    await followUpJob({ orderId: placed.id }, ctx, LATER);
    expect(sent).toHaveLength(2);
  });

  it('is a job that does nothing with a payload it did not queue', async () => {
    const placed = await order();
    await pay(placed.id);
    const { ctx, sent } = context();

    for (const payload of [null, 'x', {}, { orderId: 7 }]) {
      await followUpJob(payload, ctx, LATER);
    }

    expect(sent).toEqual([]);
  });
});
