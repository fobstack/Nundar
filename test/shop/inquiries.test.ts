import { SELF } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  INQUIRY_LIMITS,
  inquiriesCsv,
  isInquiryNo,
  MAX_INQUIRIES_PER_HOUR,
  readInquiries,
  readInquiry,
} from '../../src/plugins/shop/lib/inquiries.js';
import {
  api,
  clearShopTables,
  countD1Calls,
  createProduct,
  createVariant,
  db,
  ensureSite,
  holdWrites,
  INQUIRY_WRITE,
  ORIGIN,
  setPrice,
  storeInquiry,
  type TestProduct,
} from './helpers.js';

const SHOP = '/_mallok/p/shop';

let screw: TestProduct;
let washer: TestProduct;

/** A visitor, as Mallok tells them apart: by the address they connect from. */
const VISITOR = '203.0.113.7';
const OTHER_VISITOR = '203.0.113.8';

function post(
  path: string,
  fields: Record<string, string>,
  options: { cookie?: string; visitor?: string | null } = {},
): Promise<Response> {
  const visitor = options.visitor === undefined ? VISITOR : options.visitor;
  return SELF.fetch(`${ORIGIN}${SHOP}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(options.cookie === undefined ? {} : { cookie: options.cookie }),
      ...(visitor === null ? {} : { 'cf-connecting-ip': visitor }),
    },
    body: new URLSearchParams(fields).toString(),
    redirect: 'manual',
  });
}

/** Puts something in a cart and answers with the cart's cookie. */
async function add(
  variant: string,
  quantity: string,
  cookie?: string,
  locale?: string,
  visitor?: string | null,
): Promise<string> {
  const response = await post(
    `${locale === undefined ? '' : `/${locale}`}/cart/update`,
    { variant, quantity },
    {
      ...(cookie === undefined ? {} : { cookie }),
      ...(visitor === undefined ? {} : { visitor }),
    },
  );
  return (
    cookie ?? response.headers.get('set-cookie')?.split(';')[0] ?? 'no cookie'
  );
}

const BUYER = {
  name: 'Ada Lovelace',
  email: 'ada@buyer.example',
  company: 'Analytical Engines Ltd',
  phone: '+44 20 7946 0000',
  message: 'Please quote delivered prices.\nWe need them by March.',
};

function send(
  cookie: string | undefined,
  fields: Record<string, string> = BUYER,
  options: { visitor?: string | null; locale?: string } = {},
): Promise<Response> {
  return post(
    `${options.locale === undefined ? '' : `/${options.locale}`}/cart/inquiry`,
    fields,
    {
      ...(cookie === undefined ? {} : { cookie }),
      ...(options.visitor === undefined ? {} : { visitor: options.visitor }),
    },
  );
}

/** Where a response sends the buyer, taken apart. */
function outcome(response: Response): {
  status: number;
  path: string;
  sent: string | null;
  inquiry: string | null;
  field: string | null;
  search: string;
} {
  const location = new URL(response.headers.get('location') ?? '/', ORIGIN);
  return {
    status: response.status,
    path: location.pathname,
    sent: location.searchParams.get('sent'),
    inquiry: location.searchParams.get('inquiry'),
    field: location.searchParams.get('field'),
    search: location.search,
  };
}

interface StoredInquiry {
  id: string;
  inquiry_no: string;
  status: string;
  name: string;
  email: string;
  company: string;
  phone: string;
  message: string;
  locale: string;
  currency: string;
  line_count: number;
  subtotal_minor: number | null;
  subtotal: string;
  cart_id: string;
  ip_hash: string | null;
}

async function inquiries(): Promise<StoredInquiry[]> {
  const { results } = await db()
    .prepare('SELECT * FROM p_shop_inquiry ORDER BY created_at, id')
    .all<StoredInquiry>();
  return results;
}

async function inquiryLines(): Promise<Record<string, unknown>[]> {
  const { results } = await db()
    .prepare(
      `SELECT position, variant_id, sku, name, quantity, unit_price_minor,
              unit_price, line_total
       FROM p_shop_inquiry_line ORDER BY inquiry_id, position`,
    )
    .all<Record<string, unknown>>();
  return results;
}

async function cartLines(): Promise<
  { variant_id: string; quantity: number }[]
> {
  const { results } = await db()
    .prepare(
      'SELECT variant_id, quantity FROM p_shop_cart_line ORDER BY variant_id',
    )
    .all<{ variant_id: string; quantity: number }>();
  return results;
}

/** The jobs Mallok has been asked to run for this plugin's emails. */
async function queuedJobs(): Promise<{ type: string; payload: string }[]> {
  const { results } = await db()
    .prepare(
      "SELECT type, payload FROM job WHERE type LIKE '%inquiry_emails%' ORDER BY created_at",
    )
    .all<{ type: string; payload: string }>();
  return results;
}

async function setShopSettings(
  settings: Record<string, unknown>,
): Promise<void> {
  const response = await api('PATCH', '/_mallok/api/plugins/shop/settings', {
    buffer_rate: 0.03,
    recalc_threshold: 0.02,
    rounding: 'ending99',
    inquiry_recipient: '',
    inquiry_acknowledge: false,
    ...settings,
  });
  if (!response.ok) {
    throw new Error(`Settings were refused: ${await response.text()}`);
  }
}

describe('a cart sent as an inquiry', () => {
  beforeAll(async () => {
    await ensureSite();
    screw = await createProduct({
      title: 'Cap screw M5',
      slug: 'inquiry-cap-screw',
    });
    await createProduct({
      title: 'Zylinderschraube M5',
      slug: 'anfrage-zylinderschraube',
      locale: 'de',
      translationGroup: screw.translationGroup,
    });
    washer = await createProduct({
      title: 'Washer M5',
      slug: 'inquiry-washer',
    });
  });

  beforeEach(async () => {
    await clearShopTables();
    await db()
      .prepare("DELETE FROM job WHERE type LIKE '%inquiry_emails%'")
      .run();
    await setShopSettings({});
    await createVariant({
      id: 'cs-10',
      productGroup: screw.translationGroup,
      sku: 'CS-10',
      moq: 100,
      stock: 5000,
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
      amountMinor: 172,
      source: 'manual',
    });
    // A part with no price: what an inquiry is for.
    await createVariant({
      id: 'wa-5',
      productGroup: washer.translationGroup,
      sku: 'WA-5',
      moq: 50,
      stockPolicy: 'made_to_order',
    });
  });

  describe('sending', () => {
    it('stores the cart as one inquiry, empties it, and sends the buyer to its number', async () => {
      const cookie = await add('cs-10', '300');

      const response = await send(cookie);

      const [stored] = await inquiries();
      expect(outcome(response)).toMatchObject({
        status: 303,
        path: `${SHOP}/cart`,
        sent: stored?.inquiry_no,
        inquiry: null,
      });
      expect(isInquiryNo(stored?.inquiry_no ?? '')).toBe(true);
      expect(stored).toMatchObject({
        status: 'new',
        name: 'Ada Lovelace',
        email: 'ada@buyer.example',
        company: 'Analytical Engines Ltd',
        phone: '+44 20 7946 0000',
        message: 'Please quote delivered prices.\nWe need them by March.',
        locale: 'en',
        currency: 'USD',
        line_count: 1,
        subtotal_minor: 55500,
        subtotal: '$555.00',
        cart_id: cookie.split('=')[1],
      });
      expect(await inquiryLines()).toEqual([
        {
          position: 0,
          variant_id: 'cs-10',
          sku: 'CS-10',
          name: 'Cap screw M5',
          quantity: 300,
          unit_price_minor: 185,
          unit_price: '$1.85',
          line_total: '$555.00',
        },
      ]);
      // The cart is empty, and is still this browser's cart.
      expect(await cartLines()).toEqual([]);
      const cart = await db()
        .prepare('SELECT COUNT(*) AS n FROM p_shop_cart')
        .first<{ n: number }>();
      expect(cart?.n).toBe(1);
    });

    it('puts nothing a person typed in the address it answers with', async () => {
      const cookie = await add('cs-10', '100');

      const { search } = outcome(await send(cookie));

      for (const typed of ['Ada', 'buyer.example', 'Analytical', '7946']) {
        expect(search).not.toContain(typed);
      }
    });

    it('takes a part with no price, which is what an inquiry is for', async () => {
      const cookie = await add('cs-10', '100');
      await add('wa-5', '50', cookie);

      const response = await send(cookie);

      expect(outcome(response).sent).not.toBeNull();
      const [stored] = await inquiries();
      // A sum over lines that are not all priced would be no sum.
      expect(stored).toMatchObject({
        line_count: 2,
        subtotal_minor: null,
        subtotal: '',
      });
      expect(await inquiryLines()).toMatchObject([
        { sku: 'CS-10', unit_price_minor: 185, line_total: '$185.00' },
        {
          sku: 'WA-5',
          name: 'Washer M5',
          quantity: 50,
          unit_price_minor: null,
          unit_price: '',
          line_total: '',
        },
      ]);
    });

    it('is sent in the language and the currency of the cart', async () => {
      const cookie = await add('cs-10', '200', undefined, 'de');

      const response = await send(cookie, BUYER, { locale: 'de' });

      expect(outcome(response).path).toBe(`${SHOP}/de/cart`);
      expect((await inquiries())[0]).toMatchObject({
        locale: 'de',
        currency: 'EUR',
        subtotal_minor: 34400,
      });
      expect(await inquiryLines()).toMatchObject([
        { name: 'Zylinderschraube M5', unit_price_minor: 172 },
      ]);
    });

    it('is in the one currency the whole cart has prices in, as the cart page is', async () => {
      // A German cart, with a part that is priced in dollars alone.
      await createVariant({
        id: 'usd-only',
        productGroup: washer.translationGroup,
        sku: 'WA-USD',
        stockPolicy: 'made_to_order',
      });
      await setPrice({
        variantId: 'usd-only',
        currency: 'USD',
        amountMinor: 40,
        source: 'base',
      });
      const cookie = await add('cs-10', '100', undefined, 'de');
      await add('usd-only', '10', cookie, 'de');

      await send(cookie, BUYER, { locale: 'de' });

      expect((await inquiries())[0]).toMatchObject({
        locale: 'de',
        currency: 'USD',
        subtotal_minor: 18900,
      });
      expect(await inquiryLines()).toMatchObject([
        { sku: 'CS-10', unit_price_minor: 185 },
        { sku: 'WA-USD', unit_price_minor: 40 },
      ]);
    });

    it('needs only a name and an address', async () => {
      const cookie = await add('cs-10', '100');

      const response = await send(cookie, {
        name: 'Ada',
        email: 'ada@buyer.example',
      });

      expect(outcome(response).sent).not.toBeNull();
      expect((await inquiries())[0]).toMatchObject({
        company: '',
        phone: '',
        message: '',
      });
    });

    it('takes three round trips of its own', async () => {
      const cookie = await add('cs-10', '100');

      const calls = await countD1Calls(async () => {
        await send(cookie);
      });

      // One of Mallok's own, then the cart, what its lines depend on, and
      // the write.
      expect(calls).toBe(4);
    });

    it('snapshots its lines: a later change to the product changes no inquiry', async () => {
      const cookie = await add('cs-10', '100');
      await send(cookie);

      await db().batch([
        db().prepare(
          "UPDATE p_shop_variant SET sku = 'RENAMED' WHERE id = 'cs-10'",
        ),
        db().prepare(
          "UPDATE p_shop_price SET amount_minor = 999 WHERE variant_id = 'cs-10'",
        ),
      ]);

      expect(await inquiryLines()).toMatchObject([
        { sku: 'CS-10', unit_price_minor: 185 },
      ]);
    });
  });

  describe('a form the shop refuses', () => {
    it.each([
      ['name', { ...BUYER, name: '   ' }],
      ['name', { ...BUYER, name: 'x'.repeat(INQUIRY_LIMITS.name + 1) }],
      // A control character that is not white space: nothing a keyboard types.
      ['name', { ...BUYER, name: 'Ada\u0000Lovelace' }],
      ['email', { ...BUYER, email: 'ada at buyer' }],
      ['email', { ...BUYER, email: 'ada@buyer' }],
      ['email', { ...BUYER, email: '' }],
      // A line break inside an address is the start of another header.
      ['email', { ...BUYER, email: 'ada@buyer.example\nBcc: x@evil.example' }],
      ['email', { ...BUYER, email: 'ada@buyer.example\r\nx@evil.example' }],
      // What a `mailto:` link would read as a second recipient or a subject.
      [
        'email',
        {
          ...BUYER,
          email: 'x?bcc=boss%40evil.example&subject=Hi&to=ada@buyer.example',
        },
      ],
      [
        'email',
        { ...BUYER, email: 'victim%40evil.example%2Cada@buyer.example' },
      ],
      ['email', { ...BUYER, email: 'ada,x@buyer.example' }],
      ['email', { ...BUYER, email: 'Ada <ada@buyer.example>' }],
      ['email', { ...BUYER, email: 'ada@buyer.example;x@evil.example' }],
      ['company', { ...BUYER, company: 'Engines\u001b[31m Ltd' }],
      ['phone', { ...BUYER, phone: '+44\u0007 20' }],
      [
        'company',
        { ...BUYER, company: 'x'.repeat(INQUIRY_LIMITS.company + 1) },
      ],
      ['phone', { ...BUYER, phone: 'x'.repeat(INQUIRY_LIMITS.phone + 1) }],
      [
        'message',
        { ...BUYER, message: 'x'.repeat(INQUIRY_LIMITS.message + 1) },
      ],
    ])('names the field %s and stores nothing', async (field, fields) => {
      const cookie = await add('cs-10', '100');

      const response = await send(cookie, fields);

      expect(outcome(response)).toMatchObject({
        status: 303,
        path: `${SHOP}/cart`,
        sent: null,
        inquiry: 'invalid',
        field,
      });
      expect(await inquiries()).toEqual([]);
      expect(await cartLines()).toEqual([
        { variant_id: 'cs-10', quantity: 100 },
      ]);
    });

    it('takes the addresses people have', async () => {
      for (const email of [
        'ada@buyer.example',
        'ada.lovelace+rfq@mail.buyer.example',
        "o'brien@buyer.example",
        'einkauf@müller-bücher.example',
        'ADA_L-1@BUYER.EXAMPLE',
      ]) {
        const cookie = await add('cs-10', '100', undefined, undefined, null);
        const response = await send(
          cookie,
          { ...BUYER, email },
          { visitor: null },
        );
        expect(outcome(response).sent, email).not.toBeNull();
        await db().batch([
          db().prepare('DELETE FROM p_shop_inquiry_line'),
          db().prepare('DELETE FROM p_shop_inquiry'),
        ]);
      }
    });

    it('makes one line of a name, a company and a phone number, whatever white space came with them', async () => {
      // A tab pasted from a spreadsheet, a line break: a browser lets them
      // through, so the server does not send the form back empty for them.
      const cookie = await add('cs-10', '100');

      const response = await send(cookie, {
        ...BUYER,
        name: '  Ada\tLovelace\nBcc: someone@else.example ',
        company: 'Analytical\r\nEngines   Ltd',
        phone: '+44\t20 7946\n0000',
      });

      expect(outcome(response).sent).not.toBeNull();
      expect((await inquiries())[0]).toMatchObject({
        name: 'Ada Lovelace Bcc: someone@else.example',
        company: 'Analytical Engines Ltd',
        phone: '+44 20 7946 0000',
      });
    });

    it('counts a line break in the message once, as the field that let it through does', async () => {
      // A browser counts a line break as one character against `maxlength`
      // and sends it as two.
      const typed = `${'x'.repeat(INQUIRY_LIMITS.message - 20)}${'\n'.repeat(10)}${'y'.repeat(10)}`;
      expect(typed).toHaveLength(INQUIRY_LIMITS.message);
      const cookie = await add('cs-10', '100');

      const response = await send(cookie, {
        ...BUYER,
        message: typed.replace(/\n/g, '\r\n'),
      });

      expect(outcome(response).sent).not.toBeNull();
      expect((await inquiries())[0]?.message).toBe(typed);
    });

    it('names the first field of several, in the order the page shows them', async () => {
      const cookie = await add('cs-10', '100');

      const response = await send(cookie, { ...BUYER, email: 'no', name: '' });

      expect(outcome(response).field).toBe('name');
    });

    it('carries back nothing that was typed', async () => {
      const cookie = await add('cs-10', '100');

      const { search } = outcome(
        await send(cookie, { ...BUYER, email: 'ada at buyer' }),
      );

      expect(search).toBe('?inquiry=invalid&field=email');
    });

    it('refuses an empty cart, and a visitor with none', async () => {
      const cookie = await add('cs-10', '100');
      await post(
        '/cart/update',
        { action: 'remove', variant: 'cs-10' },
        { cookie },
      );

      expect(outcome(await send(cookie))).toMatchObject({ inquiry: 'empty' });
      expect(outcome(await send(undefined))).toMatchObject({
        inquiry: 'empty',
      });
      expect(outcome(await send('nundar_cart=not-a-cart-id'))).toMatchObject({
        inquiry: 'empty',
      });
      expect(await inquiries()).toEqual([]);
    });

    it.each([
      [
        'fewer than its minimum order',
        "UPDATE p_shop_variant SET moq = 500 WHERE id = 'cs-10'",
      ],
      [
        'more than there is',
        "UPDATE p_shop_variant SET stock = 50 WHERE id = 'cs-10'",
      ],
      [
        'more than a cart line may hold',
        "UPDATE p_shop_cart_line SET quantity = 600 WHERE variant_id = 'cs-10'",
      ],
      [
        'a part that is no longer sold',
        "UPDATE p_shop_variant SET status = 'archived' WHERE id = 'cs-10'",
      ],
    ])(
      'refuses a cart with a line of %s, and leaves it as it was',
      async (_what, change) => {
        const cookie = await add('cs-10', '100');
        await add('wa-5', '50', cookie);
        await db().prepare(change).run();
        const before = await cartLines();

        const response = await send(cookie);

        expect(outcome(response)).toMatchObject({
          status: 303,
          sent: null,
          inquiry: 'cart_problem',
        });
        expect(await inquiries()).toEqual([]);
        expect(await cartLines()).toEqual(before);
      },
    );

    it('answers what fills in the field no person sees as if all were well, and stores nothing', async () => {
      const cookie = await add('cs-10', '100');

      const response = await send(cookie, {
        ...BUYER,
        website: 'https://spam.example',
      });

      expect(outcome(response)).toMatchObject({
        status: 303,
        path: `${SHOP}/cart`,
        search: '',
      });
      expect(await inquiries()).toEqual([]);
      expect(await cartLines()).toEqual([
        { variant_id: 'cs-10', quantity: 100 },
      ]);
    });

    it('is refused by Mallok when another site caused it', async () => {
      const cookie = await add('cs-10', '100');

      const response = await SELF.fetch(`${ORIGIN}${SHOP}/cart/inquiry`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'sec-fetch-site': 'cross-site',
          cookie,
        },
        body: new URLSearchParams(BUYER).toString(),
        redirect: 'manual',
      });

      expect(response.status).toBe(403);
      expect(await inquiries()).toEqual([]);
    });

    it('does not answer a link', async () => {
      const response = await SELF.fetch(`${ORIGIN}${SHOP}/cart/inquiry`, {
        redirect: 'manual',
      });

      expect([404, 405]).toContain(response.status);
    });
  });

  describe('sent twice', () => {
    it('stores one inquiry when the same cart is sent twice at the same moment', async () => {
      const cookie = await add('cs-10', '100');
      // Both requests have read the cart, full, before either writes.
      const gate = holdWrites(INQUIRY_WRITE);

      let answers: Response[];
      try {
        const pending = Promise.all([send(cookie), send(cookie)]);
        await gate.arrived(2);
        gate.open();
        answers = await pending;
      } finally {
        gate.restore();
      }

      const stored = await inquiries();
      expect(stored).toHaveLength(1);
      expect(await inquiryLines()).toHaveLength(1);
      expect(await cartLines()).toEqual([]);
      // Both are told the number of the one inquiry there is.
      expect(answers.map((answer) => outcome(answer).sent)).toEqual([
        stored[0]?.inquiry_no,
        stored[0]?.inquiry_no,
      ]);
    });

    it('queues one job for the two', async () => {
      await setShopSettings({ inquiry_recipient: 'sales@seller.example' });
      const cookie = await add('cs-10', '100');
      const gate = holdWrites(INQUIRY_WRITE);

      try {
        const pending = Promise.all([send(cookie), send(cookie)]);
        await gate.arrived(2);
        gate.open();
        await pending;
      } finally {
        gate.restore();
      }

      // Mallok's statement takes no condition, so the batch that stored
      // nothing queued a job as well. It names an inquiry that is not there,
      // and the job finds nothing to send for it.
      const [stored] = await inquiries();
      const named = (await queuedJobs()).map(
        (job) => (JSON.parse(job.payload) as { inquiryId: string }).inquiryId,
      );
      expect(named).toHaveLength(2);
      expect(named.filter((id) => id === stored?.id)).toHaveLength(1);
    });

    it('tells both the number, not the limit, when the first of the two was the last the visitor may send', async () => {
      for (let sent = 0; sent < MAX_INQUIRIES_PER_HOUR - 1; sent += 1) {
        await send(await add('cs-10', '100'));
      }
      const cookie = await add('cs-10', '100');
      const gate = holdWrites(INQUIRY_WRITE);

      let answers: Response[];
      try {
        const pending = Promise.all([send(cookie), send(cookie)]);
        await gate.arrived(2);
        gate.open();
        answers = await pending;
      } finally {
        gate.restore();
      }

      // The second finds the visitor at the limit — because of the first.
      // It is the same request, and is told what the first was.
      const stored = await inquiries();
      expect(stored).toHaveLength(MAX_INQUIRIES_PER_HOUR);
      const last = stored.find(
        (row) => row.cart_id === cookie.split('=')[1],
      )?.inquiry_no;
      expect(answers.map((answer) => outcome(answer).sent)).toEqual([
        last,
        last,
      ]);
    });

    it('answers a form sent again a moment later with the inquiry it already became', async () => {
      const cookie = await add('cs-10', '100');
      const first = outcome(await send(cookie));

      const again = outcome(await send(cookie));

      expect(again).toMatchObject({ sent: first.sent, inquiry: null });
      expect(await inquiries()).toHaveLength(1);
    });

    it('is a new inquiry once the cart has been filled again', async () => {
      const cookie = await add('cs-10', '100');
      const first = outcome(await send(cookie));
      await add('cs-10', '200', cookie);

      const second = outcome(await send(cookie));

      expect(second.sent).not.toBeNull();
      expect(second.sent).not.toBe(first.sent);
      expect(await inquiries()).toHaveLength(2);
    });
  });

  describe('a cart that changes while it is being sent', () => {
    it.each([
      [
        'a part is added',
        "INSERT INTO p_shop_cart_line (cart_id, variant_id, quantity) SELECT id, 'wa-5', 50 FROM p_shop_cart",
        [
          { variant_id: 'cs-10', quantity: 100 },
          { variant_id: 'wa-5', quantity: 50 },
        ],
      ],
      [
        'a quantity is changed',
        "UPDATE p_shop_cart_line SET quantity = 300 WHERE variant_id = 'cs-10'",
        [{ variant_id: 'cs-10', quantity: 300 }],
      ],
    ])(
      'is not sent as it no longer is when %s, and loses nothing',
      async (_what, change, after) => {
        const cookie = await add('cs-10', '100');
        // Between the request's reading of the cart and its write: another
        // tab of the same browser.
        const gate = holdWrites(INQUIRY_WRITE);

        let response: Response;
        try {
          const pending = send(cookie);
          await gate.arrived(1);
          await db().prepare(change).run();
          gate.open();
          response = await pending;
        } finally {
          gate.restore();
        }

        expect(outcome(response)).toMatchObject({
          status: 303,
          sent: null,
          inquiry: 'cart_changed',
        });
        expect(await inquiries()).toEqual([]);
        expect(await inquiryLines()).toEqual([]);
        // What was put in the cart meanwhile is still in it.
        expect(await cartLines()).toEqual(after);
      },
    );

    it('is told there is nothing to send when the cart was emptied meanwhile', async () => {
      const cookie = await add('cs-10', '100');
      const gate = holdWrites(INQUIRY_WRITE);

      let response: Response;
      try {
        const pending = send(cookie);
        await gate.arrived(1);
        await db().prepare('DELETE FROM p_shop_cart_line').run();
        gate.open();
        response = await pending;
      } finally {
        gate.restore();
      }

      expect(outcome(response).inquiry).toBe('empty');
      expect(await inquiries()).toEqual([]);
    });
  });

  describe('the limit for one visitor', () => {
    async function sendFromNewCart(visitor: string | null): Promise<Response> {
      const cookie = await add('cs-10', '100', undefined, undefined, visitor);
      return send(cookie, BUYER, { visitor });
    }

    it(`lets one visitor send ${MAX_INQUIRIES_PER_HOUR} in an hour and refuses the next, leaving its cart`, async () => {
      for (let sent = 0; sent < MAX_INQUIRIES_PER_HOUR; sent += 1) {
        expect(outcome(await sendFromNewCart(VISITOR)).sent).not.toBeNull();
      }

      const cookie = await add('cs-10', '100');
      const over = await send(cookie, BUYER, { visitor: VISITOR });

      expect(outcome(over)).toMatchObject({
        status: 303,
        sent: null,
        inquiry: 'too_many',
      });
      expect(await inquiries()).toHaveLength(MAX_INQUIRIES_PER_HOUR);
      expect(await cartLines()).toEqual([
        { variant_id: 'cs-10', quantity: 100 },
      ]);

      // Another visitor is not held to it.
      expect(outcome(await sendFromNewCart(OTHER_VISITOR)).sent).not.toBeNull();
    });

    it('counts the last hour only', async () => {
      for (let sent = 0; sent < MAX_INQUIRIES_PER_HOUR; sent += 1) {
        await sendFromNewCart(VISITOR);
      }
      await db()
        .prepare('UPDATE p_shop_inquiry SET created_at = ?')
        .bind(new Date(Date.now() - 61 * 60 * 1000).toISOString())
        .run();

      expect(outcome(await sendFromNewCart(VISITOR)).sent).not.toBeNull();
    });

    it.each([
      ['one visitor', VISITOR],
      // And of the requests Mallok could give no mark, which are one.
      ['no visitor Mallok can tell apart', null],
    ])(
      'holds when two carts of %s are sent at the same moment',
      async (_who, visitor) => {
        for (let sent = 0; sent < MAX_INQUIRIES_PER_HOUR - 1; sent += 1) {
          await sendFromNewCart(visitor);
        }
        const one = await add('cs-10', '100', undefined, undefined, visitor);
        const other = await add('cs-10', '200', undefined, undefined, visitor);
        // Both have read "one short of the limit" before either writes.
        const gate = holdWrites(INQUIRY_WRITE);

        let answers: Response[];
        try {
          const pending = Promise.all([
            send(one, BUYER, { visitor }),
            send(other, BUYER, { visitor }),
          ]);
          await gate.arrived(2);
          gate.open();
          answers = await pending;
        } finally {
          gate.restore();
        }

        // The write asks again, and one of them is over.
        expect(await inquiries()).toHaveLength(MAX_INQUIRIES_PER_HOUR);
        expect(
          answers.map((answer) => outcome(answer).inquiry ?? 'sent').sort(),
        ).toEqual(['sent', 'too_many']);
        // The one that was refused still has its cart, and no lines of an
        // inquiry that was never stored were written for it.
        expect(await cartLines()).toHaveLength(1);
        expect(await inquiryLines()).toHaveLength(MAX_INQUIRIES_PER_HOUR);
      },
    );

    it('says the limit, not "sent", when a cart that was sent a moment ago is filled and sent again over it', async () => {
      const cookie = await add('cs-10', '100');
      const first = outcome(await send(cookie));
      await add('cs-10', '200', cookie);
      // The visitor reaches the limit between this request's reading and
      // its write.
      // Its own write is held; the ones this test makes meanwhile pass.
      const gate = holdWrites(INQUIRY_WRITE, 1);

      let second: Response;
      try {
        const pending = send(cookie);
        await gate.arrived(1);
        for (let other = 0; other < MAX_INQUIRIES_PER_HOUR - 1; other += 1) {
          await storeInquiry({
            id: `other-${other}`,
            at: new Date().toISOString(),
            ipHash: (await inquiries())[0]?.ip_hash ?? null,
          });
        }
        gate.open();
        second = await pending;
      } finally {
        gate.restore();
      }

      expect(outcome(second)).toMatchObject({
        sent: null,
        inquiry: 'too_many',
      });
      expect(first.sent).not.toBeNull();
      expect(await inquiries()).toHaveLength(MAX_INQUIRIES_PER_HOUR);
      expect(await cartLines()).toEqual([
        { variant_id: 'cs-10', quantity: 200 },
      ]);
    });

    it('counts together the requests Mallok could give no mark', async () => {
      // No connecting address: a call that did not come through the edge.
      // They are one visitor, as they are to Mallok's own rate limit.
      for (let sent = 0; sent < MAX_INQUIRIES_PER_HOUR; sent += 1) {
        const cookie = await add('cs-10', '100', undefined, undefined, null);
        expect(
          outcome(await send(cookie, BUYER, { visitor: null })).sent,
        ).not.toBeNull();
      }
      const cookie = await add('cs-10', '100', undefined, undefined, null);

      const over = await send(cookie, BUYER, { visitor: null });

      expect(outcome(over).inquiry).toBe('too_many');
      expect((await inquiries()).every((row) => row.ip_hash === null)).toBe(
        true,
      );
    });

    it('stores a one-way mark of the visitor, never the address', async () => {
      await sendFromNewCart(VISITOR);

      const [stored] = await inquiries();
      expect(stored?.ip_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(stored)).not.toContain(VISITOR);
    });
  });

  describe('the emails it owes', () => {
    it('queues no job when nobody is to be told', async () => {
      const cookie = await add('cs-10', '100');

      await send(cookie);

      expect(await queuedJobs()).toEqual([]);
    });

    it('queues one job, naming the inquiry, when the seller is to be told', async () => {
      await setShopSettings({ inquiry_recipient: 'sales@seller.example' });
      const cookie = await add('cs-10', '100');

      await send(cookie);

      const [stored] = await inquiries();
      const jobs = await queuedJobs();
      expect(jobs).toHaveLength(1);
      expect(JSON.parse(jobs[0]?.payload ?? '{}')).toMatchObject({
        inquiryId: stored?.id,
      });
      // Its payload is an id: nothing a person typed is copied into a queue.
      expect(jobs[0]?.payload).not.toContain('Ada');
    });

    it('queues one when only the buyer is to be told', async () => {
      await setShopSettings({ inquiry_acknowledge: true });
      const cookie = await add('cs-10', '100');

      await send(cookie);

      expect(await queuedJobs()).toHaveLength(1);
    });

    it('queues none for a visitor over the limit', async () => {
      await setShopSettings({ inquiry_recipient: 'sales@seller.example' });
      for (let sent = 0; sent < MAX_INQUIRIES_PER_HOUR; sent += 1) {
        await send(await add('cs-10', '100'));
      }
      const before = (await queuedJobs()).length;

      for (let attempt = 0; attempt < 3; attempt += 1) {
        await send(await add('cs-10', '100'));
      }

      // A job that finds nothing to send still takes one of the five turns
      // Mallok gives the whole site each minute.
      expect((await queuedJobs()).length).toBe(before);
    });
  });

  describe('reading and exporting', () => {
    const now = new Date('2026-10-09T08:00:00.000Z');

    const LINES = [
      {
        variantId: 'cs-10',
        sku: 'CS-10',
        name: 'Cap screw, "M5"',
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

    function store(over: {
      id: string;
      name?: string;
      company?: string;
      message?: string;
      at?: Date;
    }): Promise<string> {
      return storeInquiry({
        id: over.id,
        at: (over.at ?? now).toISOString(),
        form: {
          ...BUYER,
          ...(over.name === undefined ? {} : { name: over.name }),
          ...(over.company === undefined ? {} : { company: over.company }),
          ...(over.message === undefined ? {} : { message: over.message }),
        },
        lines: LINES,
      });
    }

    it('reads an inquiry with its lines in one round trip', async () => {
      await store({ id: 'one' });

      let detail: Awaited<ReturnType<typeof readInquiry>> = null;
      const calls = await countD1Calls(async () => {
        detail = await readInquiry(db(), 'one');
      });

      expect(calls).toBe(1);
      expect(detail).toMatchObject({
        id: 'one',
        name: 'Ada Lovelace',
        country: 'GB',
        subtotalMinor: null,
        notifiedAt: null,
        lines: [
          { sku: 'CS-10', quantity: 300, unitPriceMinor: 185 },
          { sku: 'WA-5', quantity: 50, unitPriceMinor: null },
        ],
      });
      expect(await readInquiry(db(), 'nobody')).toBeNull();
    });

    it('exports the inquiries named, or the latest when none is, newest first', async () => {
      await store({ id: 'old', at: new Date('2026-10-01T08:00:00.000Z') });
      await store({ id: 'new', at: new Date('2026-10-08T08:00:00.000Z') });

      expect((await readInquiries(db(), [], 10)).map((row) => row.id)).toEqual([
        'new',
        'old',
      ]);
      expect((await readInquiries(db(), [], 1)).map((row) => row.id)).toEqual([
        'new',
      ]);
      expect(
        (await readInquiries(db(), ['old', 'nobody'], 10)).map((row) => row.id),
      ).toEqual(['old']);
    });

    it('writes one CSV row for each line, with amounts as plain numbers', async () => {
      await store({ id: 'one', message: 'Two lines,\nand a "quote".' });

      const csv = inquiriesCsv(await readInquiries(db(), [], 10));
      const [header, first, ...rest] = csv.replace(/^﻿/, '').split('\r\n');

      expect(csv.startsWith('﻿')).toBe(true);
      expect(header).toBe(
        'inquiry_no,created_at,status,name,company,email,phone,country,locale,currency,sku,product,quantity,unit_price,line_total,message',
      );
      // The message keeps its own line break, inside its quotes: a row ends
      // at a carriage return and a line feed, and this is a line feed alone.
      expect(first).toMatch(
        /^RFQ-261009-[0-9A-Z]{8},2026-10-09T08:00:00\.000Z,new,Ada Lovelace,Analytical Engines Ltd,ada@buyer\.example,'\+44 20 7946 0000,GB,en,USD,CS-10,"Cap screw, ""M5""",300,1\.85,555\.00,"Two lines,\nand a ""quote""\."$/,
      );
      // A line with no price has no amounts.
      expect(rest[0]).toMatch(
        /,WA-5,Washer M5,50,,,"Two lines,\nand a ""quote""\."$/,
      );
      expect(rest).toHaveLength(2);
      expect(rest[1]).toBe('');
    });

    it('makes text of a cell a spreadsheet would run as a formula', async () => {
      await store({
        id: 'one',
        name: '=HYPERLINK("https://evil.example","x")',
        company: '@SUM(1+1)',
        message: '+1 for speed\n@home\tand\t=2+2',
      });

      const csv = inquiriesCsv(await readInquiries(db(), [], 10));

      expect(csv).toContain(`"'=HYPERLINK(""https://evil.example"",""x"")"`);
      expect(csv).toContain(",'@SUM(1+1),");
      // A line break inside a value starts a row to a spreadsheet that does
      // not honour the quotes: what follows it is made text as well.
      // And so does a tab, which is a separator of its own to some.
      expect(csv).toContain(`"'+1 for speed\n'@home\tand\t'=2+2"`);
      // So is a phone number that begins with a plus sign, the ordinary
      // case: left alone, a spreadsheet reads `+1-555-0100` as a sum.
      expect(csv).toContain(",'+44 20 7946 0000,");
    });

    it.each([
      ['-2+3', "'-2+3"],
      // Where the list separator is a semicolon, a spreadsheet splits a row
      // on it whatever the quotes say, and each piece is a cell.
      ["x;=cmd|'/C calc'!A0;z", "x;'=cmd|'/C calc'!A0;z"],
      [';=1+1', ";'=1+1"],
      ['m;@SUM(1+1)*cmd', "m;'@SUM(1+1)*cmd"],
      ['a;-1;+2', "a;'-1;'+2"],
      // Not a formula anywhere a cell could begin.
      ['3 - 2 = 1; a @ b', '3 - 2 = 1; a @ b'],
    ])('leaves no piece of %j a formula', async (typed, exported) => {
      await store({ id: 'one', company: typed });

      const csv = inquiriesCsv(await readInquiries(db(), [], 10));

      expect(csv).toContain(`,Ada Lovelace,${exported},ada@buyer.example,`);
    });
  });
});
