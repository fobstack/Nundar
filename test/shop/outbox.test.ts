import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  markOutboxHandled,
  orderChangedOutbox,
  paymentRefusedOutbox,
  pendingOutbox,
} from '../../src/plugins/shop/lib/outbox.js';
import { clearShopTables, countD1Calls, db, ensureSite } from './helpers.js';

const T0 = new Date('2026-10-05T08:00:00.000Z');
const T1 = new Date('2026-10-05T08:01:00.000Z');
const T2 = new Date('2026-10-05T08:02:00.000Z');

/** An order row with just enough in it to be in a status. */
async function orderIn(id: string, status: string): Promise<void> {
  await db()
    .prepare(
      `INSERT INTO p_shop_order
         (id, order_no, status, currency, subtotal_minor, total_minor, email,
          shipping_address, locale, created_at, updated_at)
       VALUES (?, ?, ?, 'USD', 100, 100, 'a@example.com', '{}', 'en', ?, ?)`,
    )
    .bind(id, `ND-${id}`, status, T0.toISOString(), T0.toISOString())
    .run();
}

async function handledAt(id: string): Promise<string | null | undefined> {
  const row = await db()
    .prepare('SELECT handled_at FROM p_shop_outbox WHERE id = ?')
    .bind(id)
    .first<{ handled_at: string | null }>();
  return row?.handled_at;
}

describe('the outbox', () => {
  beforeAll(ensureSite);
  beforeEach(clearShopTables);

  it('writes a row for a change only while the order is in the status it was read in', async () => {
    await orderIn('o1', 'pending');

    // The order is pending, as read: the row is written.
    await orderChangedOutbox(db(), {
      orderId: 'o1',
      from: 'pending',
      to: 'paid',
      now: T1,
    }).run();
    // Read as paid, which it is not: nothing is written.
    await orderChangedOutbox(db(), {
      orderId: 'o1',
      from: 'paid',
      to: 'shipped',
      now: T1,
    }).run();

    expect(await pendingOutbox(db(), { limit: 10 })).toEqual([
      {
        id: 'order.paid:o1',
        topic: 'order.paid',
        orderId: 'o1',
        ref: null,
        createdAt: T1.toISOString(),
      },
    ]);
  });

  it('writes nothing when a further condition does not hold', async () => {
    await orderIn('o1', 'pending');

    await orderChangedOutbox(db(), {
      orderId: 'o1',
      from: 'pending',
      to: 'oversold',
      now: T1,
      andIf: { sql: '? = ?', binds: ['one', 'another'] },
    }).run();
    expect(await pendingOutbox(db(), { limit: 10 })).toEqual([]);

    await orderChangedOutbox(db(), {
      orderId: 'o1',
      from: 'pending',
      to: 'oversold',
      now: T1,
      andIf: { sql: '? = ?', binds: ['same', 'same'] },
    }).run();
    expect(
      (await pendingOutbox(db(), { limit: 10 })).map((row) => row.id),
    ).toEqual(['order.oversold:o1']);
  });

  it('keys a refused payment by its event and names the payment to refund', async () => {
    await orderIn('o1', 'cancelled');

    await paymentRefusedOutbox(db(), {
      orderId: 'o1',
      from: 'cancelled',
      eventId: 'evt_1',
      paymentIntentId: 'pi_1',
      now: T1,
    }).run();
    // A second, different payment sent to the same order is its own duty.
    await paymentRefusedOutbox(db(), {
      orderId: 'o1',
      from: 'cancelled',
      eventId: 'evt_2',
      paymentIntentId: 'pi_2',
      now: T2,
    }).run();

    expect(await pendingOutbox(db(), { limit: 10 })).toEqual([
      {
        id: 'payment.refused:evt_1',
        topic: 'payment.refused',
        orderId: 'o1',
        ref: 'pi_1',
        createdAt: T1.toISOString(),
      },
      {
        id: 'payment.refused:evt_2',
        topic: 'payment.refused',
        orderId: 'o1',
        ref: 'pi_2',
        createdAt: T2.toISOString(),
      },
    ]);
  });

  it('returns what is owed oldest first, bounded, for all orders or for one', async () => {
    await orderIn('o1', 'pending');
    await orderIn('o2', 'pending');
    await orderIn('o3', 'pending');
    for (const [orderId, now] of [
      ['o2', T2],
      ['o1', T0],
      ['o3', T1],
    ] as const) {
      await orderChangedOutbox(db(), {
        orderId,
        from: 'pending',
        to: 'paid',
        now,
      }).run();
    }

    expect(
      (await pendingOutbox(db(), { limit: 10 })).map((row) => row.orderId),
    ).toEqual(['o1', 'o3', 'o2']);
    expect(
      (await pendingOutbox(db(), { limit: 2 })).map((row) => row.orderId),
    ).toEqual(['o1', 'o3']);
    expect(
      (await pendingOutbox(db(), { limit: 10, orderId: 'o3' })).map(
        (row) => row.id,
      ),
    ).toEqual(['order.paid:o3']);
  });

  it('stops returning a row once it is marked handled, and keeps the first time', async () => {
    await orderIn('o1', 'pending');
    await orderIn('o2', 'pending');
    for (const orderId of ['o1', 'o2']) {
      await orderChangedOutbox(db(), {
        orderId,
        from: 'pending',
        to: 'paid',
        now: T0,
      }).run();
    }

    await markOutboxHandled(db(), ['order.paid:o1'], T1);
    // Handling it again — the marking is what a retry repeats — changes
    // nothing, and an id that does not exist is not an error.
    await markOutboxHandled(db(), ['order.paid:o1', 'order.paid:nope'], T2);

    expect(
      (await pendingOutbox(db(), { limit: 10 })).map((row) => row.id),
    ).toEqual(['order.paid:o2']);
    expect(await handledAt('order.paid:o1')).toBe(T1.toISOString());
    expect(await handledAt('order.paid:o2')).toBeNull();
  });

  it('marks any number of rows in one round trip, and none in none', async () => {
    await orderIn('o1', 'pending');
    const ids: string[] = [];
    for (const to of ['paid', 'oversold', 'cancelled'] as const) {
      await orderChangedOutbox(db(), {
        orderId: 'o1',
        from: 'pending',
        to,
        now: T0,
      }).run();
      ids.push(`order.${to}:o1`);
    }

    expect(await countD1Calls(() => markOutboxHandled(db(), ids, T1))).toBe(1);
    expect(await countD1Calls(() => markOutboxHandled(db(), [], T1))).toBe(0);
    expect(await pendingOutbox(db(), { limit: 10 })).toEqual([]);
  });
});
