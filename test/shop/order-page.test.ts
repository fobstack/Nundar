import {
  createExecutionContext,
  createScheduledController,
  env,
  SELF,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import worker from '../../src/worker/index.js';
import {
  clearShopTables,
  createProduct,
  createShippingZone,
  createVariant,
  db,
  ensureSite,
  ORIGIN,
  type StripeCall,
  setPrice,
  setShopSecrets,
  setShopSettings,
  signStripePayload,
  stockOf,
  stubStripe,
  type TestProduct,
} from './helpers.js';

const SHOP = '/_mallok/p/shop';
const WEBHOOK_SECRET = 'whsec_order_page';

let bolt: TestProduct;
let stripe: { calls: StripeCall[]; restore: () => void } | null = null;

function post(
  path: string,
  fields: Record<string, string>,
  cookie?: string,
): Promise<Response> {
  return SELF.fetch(`${ORIGIN}${SHOP}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(cookie === undefined ? {} : { cookie }),
    },
    body: new URLSearchParams(fields).toString(),
    redirect: 'manual',
  });
}

/** An order placed through checkout: its id, number, link, and the cart. */
async function placedOrder(locale = ''): Promise<{
  id: string;
  orderNo: string;
  link: URL;
  cookie: string;
}> {
  const added = await post(`${locale}/cart/update`, {
    variant: 'hb-m8',
    quantity: '100',
  });
  const cookie = added.headers.get('set-cookie')?.split(';')[0] ?? '';
  await post(
    `${locale}/checkout/place`,
    {
      email: 'ada@buyer.example',
      company: 'Analytical Engines Ltd',
      recipient: 'Ada Lovelace',
      line1: 'Hafenstraße 1',
      postal_code: '20457',
      city: 'Hamburg',
      country: 'DE',
    },
    cookie,
  );
  const session = stripe?.calls.findLast(
    (call) => call.path === '/v1/checkout/sessions',
  );
  const link = new URL(session?.body.get('success_url') ?? '');
  const row = await db()
    .prepare('SELECT id, order_no FROM p_shop_order ORDER BY created_at DESC')
    .first<{ id: string; order_no: string }>();
  return { id: row?.id ?? '', orderNo: row?.order_no ?? '', link, cookie };
}

/** Stripe's word that the order was paid, signed and delivered. */
async function deliverPayment(
  orderId: string,
  amount: number,
  secret = WEBHOOK_SECRET,
): Promise<Response> {
  const body = JSON.stringify({
    id: `evt_${orderId}`,
    object: 'event',
    type: 'payment_intent.succeeded',
    data: {
      object: {
        id: `pi_${orderId}`,
        object: 'payment_intent',
        amount,
        amount_received: amount,
        currency: 'usd',
        metadata: { order_id: orderId },
      },
    },
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await signStripePayload(body, timestamp, secret);
  return SELF.fetch(`${ORIGIN}${SHOP}/stripe/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'stripe-signature': `t=${timestamp},v1=${signature}`,
    },
    body,
  });
}

/** Mallok's once-a-minute tick, which runs the plugin's jobs. */
async function tick(): Promise<void> {
  const execution = createExecutionContext();
  await worker.scheduled?.(
    createScheduledController({ scheduledTime: Date.now() + 1000 }),
    env as never,
    execution,
  );
  await waitOnExecutionContext(execution);
}

beforeAll(async () => {
  await ensureSite();
  bolt = await createProduct({ title: 'Hex bolt M8', slug: 'order-page-bolt' });
});

beforeEach(async () => {
  await clearShopTables();
  await db().prepare('DELETE FROM job').run();
  await setShopSecrets({
    stripe_secret_key: 'sk_test_order_page',
    stripe_webhook_secret: WEBHOOK_SECRET,
  });
  await setShopSettings({
    tax_mode: 'none',
    terms_path: '',
    inquiry_recipient: 'sales@seller.example',
  });
  await createVariant({
    id: 'hb-m8',
    productGroup: bolt.translationGroup,
    sku: 'HB-M8',
    moq: 10,
    stock: 1000,
  });
  for (const [currency, amountMinor] of [
    ['USD', 990],
    ['EUR', 900],
  ] as const) {
    await setPrice({
      variantId: 'hb-m8',
      currency,
      amountMinor,
      source: 'base',
    });
  }
  await createShippingZone({
    name: 'Europe',
    countries: ['DE'],
    rates: [
      { currency: 'USD', amountMinor: 4900 },
      { currency: 'EUR', amountMinor: 4500 },
    ],
  });
  stripe = stubStripe();
});

afterEach(() => {
  stripe?.restore();
  stripe = null;
});

describe('an order’s page', () => {
  it('opens with the link Stripe brings the buyer back by', async () => {
    const order = await placedOrder();

    const response = await SELF.fetch(order.link);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain(order.orderNo);
    expect(html).toContain('Waiting for the payment to be confirmed');
    expect(html).toContain('HB-M8');
    expect(html).toContain('$1,039.00');
    expect(html).toContain('Analytical Engines Ltd');
    expect(html).toContain('Germany');
    // Never kept, never indexed: it is one buyer's. And its address, which
    // carries the secret, is passed to no other site.
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('x-robots-tag')).toContain('noindex');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('opens in the language the order was placed in', async () => {
    const order = await placedOrder('/de');

    const html = await (await SELF.fetch(order.link)).text();

    expect(order.link.pathname).toBe(`${SHOP}/de/order/${order.orderNo}`);
    expect(html).toContain('Zahlungsbestätigung ausstehend');
    expect(html).toContain('Deutschland');
  });

  it('opens for nobody else: a wrong secret, none, and an order that is not there answer alike', async () => {
    const order = await placedOrder();
    const wrong = new URL(order.link);
    wrong.searchParams.set('k', 'A'.repeat(43));
    const none = new URL(order.link);
    none.searchParams.delete('k');
    const unknown = new URL(order.link);
    unknown.pathname = `${SHOP}/order/ND-261031-AAAAAAAA`;

    for (const url of [wrong, none, unknown]) {
      const response = await SELF.fetch(url);
      const html = await response.text();
      expect(response.status, url.toString()).toBe(404);
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
      expect(html).toContain('This order cannot be shown');
      expect(html).not.toContain('HB-M8');
    }
  });
});

describe('a payment, from Stripe’s delivery to the buyer’s inbox', () => {
  it('is refused until the signing secret is set, so that Stripe delivers it again', async () => {
    const order = await placedOrder();
    await setShopSecrets({ stripe_webhook_secret: null });

    const response = await deliverPayment(order.id, 103_900);

    expect(response.status).toBe(503);
    const row = await db()
      .prepare('SELECT status FROM p_shop_order WHERE id = ?')
      .bind(order.id)
      .first<{ status: string }>();
    expect(row?.status).toBe('pending');
  });

  it('takes payments with secrets saved with the white space they were pasted with', async () => {
    // The first purchase in Stripe's test mode failed here: the signing
    // secret was saved with the space before it on the line `stripe listen`
    // prints, and every delivery was refused as signed with another secret.
    await setShopSecrets({
      stripe_secret_key: ' sk_test_order_page\n',
      stripe_webhook_secret: ` ${WEBHOOK_SECRET}`,
    });
    const order = await placedOrder();

    const response = await deliverPayment(order.id, 103_900);

    const session = stripe?.calls.findLast(
      (call) => call.path === '/v1/checkout/sessions',
    );
    expect(session?.headers.get('authorization')).toBe(
      'Bearer sk_test_order_page',
    );
    expect(response.status).toBe(200);
    expect(await stockOf('hb-m8')).toBe(900);
  });

  it('refuses a delivery signed with another secret', async () => {
    const order = await placedOrder();

    const response = await deliverPayment(order.id, 103_900, 'whsec_other');

    expect(response.status).toBe(400);
  });

  it('pays the order, takes the stock, empties the cart, and queues what it owes', async () => {
    const order = await placedOrder();

    const response = await deliverPayment(order.id, 103_900);

    expect(response.status).toBe(200);
    expect(await stockOf('hb-m8')).toBe(900);
    const lines = await db()
      .prepare('SELECT COUNT(*) AS n FROM p_shop_cart_line')
      .first<{ n: number }>();
    expect(lines?.n).toBe(0);
    const html = await (await SELF.fetch(order.link)).text();
    expect(html).toContain('Paid — being prepared');
    const queued = await db()
      .prepare("SELECT payload FROM job WHERE type LIKE '%order_follow_up%'")
      .all<{ payload: string }>();
    expect(queued.results.map((row) => JSON.parse(row.payload))).toEqual([
      { orderId: order.id },
    ]);
  });

  it('is followed on the next tick by the buyer’s confirmation and the seller’s notice', async () => {
    const order = await placedOrder();
    await deliverPayment(order.id, 103_900);

    await tick();

    const mail = await db()
      .prepare(
        "SELECT payload FROM job WHERE type NOT LIKE '%order_follow_up%' ORDER BY id",
      )
      .all<{ payload: string }>();
    const messages = mail.results.map(
      (row) => JSON.parse(row.payload) as Record<string, unknown>,
    );
    const text = JSON.stringify(messages);
    expect(text).toContain('ada@buyer.example');
    expect(text).toContain(`Order ${order.orderNo} confirmed`);
    expect(text).toContain('sales@seller.example');
    expect(text).toContain(`New order ${order.orderNo}`);
    // The confirmation carries the buyer's own link, which opens the order.
    expect(text).toContain(order.link.toString().replace(/&/g, '\\u0026'));
    const owed = await db()
      .prepare('SELECT handled_at FROM p_shop_outbox WHERE order_id = ?')
      .bind(order.id)
      .all<{ handled_at: string | null }>();
    expect(owed.results.every((row) => row.handled_at !== null)).toBe(true);
  });

  it('refuses a payment that does not come to the order’s total, and keeps the stock', async () => {
    const order = await placedOrder();

    const response = await deliverPayment(order.id, 100);

    expect(response.status).toBe(200);
    expect(await stockOf('hb-m8')).toBe(1000);
    const refused = await db()
      .prepare(
        'SELECT id, order_status, state FROM p_shop_refused_payment WHERE order_id = ?',
      )
      .bind(order.id)
      .all<{ id: string; order_status: string; state: string }>();
    expect(refused.results).toEqual([
      { id: `evt_${order.id}`, order_status: 'pending', state: 'to_refund' },
    ]);
  });
});
