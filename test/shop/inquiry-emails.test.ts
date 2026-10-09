import {
  createExecutionContext,
  createScheduledController,
  env,
  SELF,
  waitOnExecutionContext,
} from 'cloudflare:test';
import type { EmailMessage, PluginContext } from 'mallok/worker';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { InquiryDetail } from '../../src/plugins/shop/lib/inquiries.js';
import {
  inquiryAcknowledgementEmail,
  inquiryNotificationEmail,
} from '../../src/plugins/shop/lib/inquiry-email.js';
import {
  inquirySettings,
  owesEmail,
  sendInquiryEmails,
} from '../../src/plugins/shop/lib/inquiry-jobs.js';
import worker from '../../src/worker/index.js';
import {
  api,
  clearShopTables,
  createProduct,
  createVariant,
  db,
  ensureSite,
  ORIGIN,
  setPrice,
  storeInquiry,
} from './helpers.js';

const INQUIRY: InquiryDetail = {
  id: 'inq-1',
  inquiryNo: 'RFQ-261009-7K3M9QXA',
  status: 'new',
  name: 'Ada <b>Lovelace</b>',
  email: 'ada@buyer.example',
  company: 'Engines & Sons',
  phone: '+44 20 7946 0000',
  message: 'Delivered prices, please.\n<script>alert(1)</script>',
  locale: 'de',
  currency: 'EUR',
  country: 'GB',
  subtotalMinor: null,
  notifiedAt: null,
  acknowledgedAt: null,
  createdAt: '2026-10-09T08:00:00.000Z',
  lines: [
    {
      variantId: 'cs-10',
      sku: 'CS-10',
      name: 'Zylinderschraube <M5>',
      quantity: 300,
      unitPriceMinor: 172,
    },
    {
      variantId: 'wa-5',
      sku: 'WA-5',
      name: 'Scheibe M5',
      quantity: 50,
      unitPriceMinor: null,
    },
  ],
};

describe('the email that tells the seller', () => {
  const mail = inquiryNotificationEmail(INQUIRY, 'Titan & Co');

  it('names the inquiry and who sent it, and is answered to the buyer', () => {
    expect(mail.subject).toBe(
      'Inquiry RFQ-261009-7K3M9QXA from Ada <b>Lovelace</b>, Engines & Sons',
    );
    expect(mail.replyTo).toBe('ada@buyer.example');
  });

  it('says in text everything the buyer sent', () => {
    expect(mail.text).toBe(
      [
        'A cart was sent as an inquiry on Titan & Co.',
        '',
        'Name: Ada <b>Lovelace</b>',
        'Company: Engines & Sons',
        'Email: ada@buyer.example',
        'Phone: +44 20 7946 0000',
        'Country: GB',
        'Language: de',
        'Currency: EUR',
        '',
        'CS-10  Zylinderschraube <M5>  × 300  €1.72  €516.00',
        'WA-5  Scheibe M5  × 50  on request  on request',
        '',
        'Subtotal: Not stated: at least one line has no price.',
        '',
        'Message:',
        'Delivered prices, please.',
        '<script>alert(1)</script>',
        '',
        'Reply to this email to answer the buyer.',
      ].join('\n'),
    );
  });

  it('lets nothing a buyer typed become markup', () => {
    expect(mail.html).not.toContain('<b>Lovelace</b>');
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).not.toContain('<M5>');
    expect(mail.html).toContain('Ada &lt;b&gt;Lovelace&lt;/b&gt;');
    expect(mail.html).toContain('Engines &amp; Sons');
    expect(mail.html).toContain('Titan &amp; Co');
    expect(mail.html).toContain('Zylinderschraube &lt;M5&gt;');
    // The message keeps its lines.
    expect(mail.html).toContain(
      'Delivered prices, please.<br>&lt;script&gt;alert(1)&lt;/script&gt;',
    );
  });

  it('leaves out what the buyer left out, and states a sum when there is one', () => {
    const plain = inquiryNotificationEmail(
      {
        ...INQUIRY,
        company: '',
        phone: '',
        country: '',
        message: '',
        subtotalMinor: 51600,
        lines: INQUIRY.lines.slice(0, 1),
      },
      'Titan',
    );

    expect(plain.subject).toBe(
      'Inquiry RFQ-261009-7K3M9QXA from Ada <b>Lovelace</b>',
    );
    expect(plain.text).not.toMatch(/Company|Phone|Country|Message/);
    expect(plain.text).toContain('Subtotal: €516.00');
  });
});

describe('the email that tells the buyer', () => {
  it('is written in the language the cart was sent in', () => {
    const mail = inquiryAcknowledgementEmail(INQUIRY);

    expect(mail.subject).toBe(
      'Ihre Anfrage RFQ-261009-7K3M9QXA ist eingegangen',
    );
    expect(mail.text).toContain('Vielen Dank für Ihre Anfrage.');
    expect(mail.text).toContain(
      'CS-10  Zylinderschraube <M5>  × 300  1,72\u00a0€  516,00\u00a0€',
    );
    expect(mail.text).toContain(
      'WA-5  Scheibe M5  × 50  auf Anfrage  auf Anfrage',
    );
    // No sum over lines that are not all priced.
    expect(mail.text).not.toContain('Zwischensumme');
    expect(mail.html).toContain('Zylinderschraube &lt;M5&gt;');
    expect(mail.html).not.toContain('<M5>');
  });

  it.each([
    [
      'en',
      'We have received your request RFQ-261009-7K3M9QXA',
      'Subtotal: €516.00',
    ],
    [
      'fr',
      'Nous avons bien reçu votre demande RFQ-261009-7K3M9QXA',
      'Sous-total',
    ],
    ['es', 'Hemos recibido su solicitud RFQ-261009-7K3M9QXA', 'Subtotal'],
    // A language with no translation reads English.
    ['ja', 'We have received your request RFQ-261009-7K3M9QXA', 'Subtotal'],
  ])('reads %s', (locale, subject, subtotal) => {
    const mail = inquiryAcknowledgementEmail({
      ...INQUIRY,
      locale,
      subtotalMinor: 51600,
      lines: INQUIRY.lines.slice(0, 1),
    });

    expect(mail.subject).toBe(subject);
    expect(mail.text).toContain(subtotal);
  });

  it('never repeats what the buyer typed about themselves', () => {
    const mail = inquiryAcknowledgementEmail(INQUIRY);

    // It goes to an address nobody has proved is theirs.
    for (const typed of ['Lovelace', 'Engines', '7946', 'Delivered prices']) {
      expect(mail.text).not.toContain(typed);
      expect(mail.html).not.toContain(typed);
    }
  });
});

describe('the settings an inquiry is announced by', () => {
  it('takes an address that is one, and nothing else', () => {
    expect(
      inquirySettings({ inquiry_recipient: ' sales@seller.example ' }),
    ).toEqual({
      recipient: 'sales@seller.example',
      acknowledge: false,
    });
    expect(inquirySettings({ inquiry_recipient: 'sales' }).recipient).toBe('');
    expect(inquirySettings({ inquiry_recipient: 7 }).recipient).toBe('');
    expect(inquirySettings({}).recipient).toBe('');
  });

  it('confirms to the buyer only when that is switched on', () => {
    expect(inquirySettings({ inquiry_acknowledge: true }).acknowledge).toBe(
      true,
    );
    expect(inquirySettings({ inquiry_acknowledge: 'true' }).acknowledge).toBe(
      false,
    );
    expect(inquirySettings({}).acknowledge).toBe(false);
  });

  it('owes an email when either is set', () => {
    expect(owesEmail({ recipient: '', acknowledge: false })).toBe(false);
    expect(owesEmail({ recipient: 'a@b.example', acknowledge: false })).toBe(
      true,
    );
    expect(owesEmail({ recipient: '', acknowledge: true })).toBe(true);
  });
});

describe('the job that sends an inquiry’s emails', () => {
  const now = new Date('2026-10-09T08:00:00.000Z');

  beforeAll(ensureSite);
  beforeEach(async () => {
    await clearShopTables();
    await storeInquiry({
      id: 'inq-1',
      at: now.toISOString(),
      locale: 'fr',
      currency: 'EUR',
      country: '',
      lines: [
        {
          variantId: 'cs-10',
          sku: 'CS-10',
          name: 'Vis M5',
          quantity: 100,
          unitPriceMinor: 172,
        },
      ],
    });
    await db()
      .prepare(
        "UPDATE p_shop_inquiry SET inquiry_no = 'RFQ-261009-7K3M9QXA' WHERE id = 'inq-1'",
      )
      .run();
  });

  function context(
    settings: Record<string, unknown>,
    sendEmail?: (message: EmailMessage) => Promise<string>,
  ): { ctx: PluginContext; sent: EmailMessage[] } {
    const sent: EmailMessage[] = [];
    return {
      sent,
      ctx: {
        db: db(),
        settings,
        site: { name: 'Titan' },
        sendEmail:
          sendEmail ??
          (async (message: EmailMessage) => {
            sent.push(message);
            return `job-${sent.length}`;
          }),
      } as unknown as PluginContext,
    };
  }

  async function marks(): Promise<{
    notified_at: string | null;
    acknowledged_at: string | null;
  } | null> {
    return db()
      .prepare(
        "SELECT notified_at, acknowledged_at FROM p_shop_inquiry WHERE id = 'inq-1'",
      )
      .first();
  }

  const BOTH = {
    inquiry_recipient: 'sales@seller.example',
    inquiry_acknowledge: true,
  };

  it('tells the seller, answerable to the buyer, and marks it', async () => {
    const { ctx, sent } = context({
      inquiry_recipient: 'sales@seller.example',
    });

    await sendInquiryEmails({ inquiryId: 'inq-1' }, ctx, now);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: 'sales@seller.example',
      replyTo: 'ada@buyer.example',
      subject: 'Inquiry RFQ-261009-7K3M9QXA from Ada Lovelace',
    });
    expect(await marks()).toEqual({
      notified_at: now.toISOString(),
      acknowledged_at: null,
    });
  });

  it('tells the buyer too, in their language, when that is switched on', async () => {
    const { ctx, sent } = context(BOTH);

    await sendInquiryEmails({ inquiryId: 'inq-1' }, ctx, now);

    expect(sent.map((message) => message.to)).toEqual([
      'sales@seller.example',
      'ada@buyer.example',
    ]);
    expect(sent[1]?.subject).toBe(
      'Nous avons bien reçu votre demande RFQ-261009-7K3M9QXA',
    );
    // The buyer's has no reply address of anyone else's.
    expect(sent[1]).not.toHaveProperty('replyTo');
    expect(await marks()).toEqual({
      notified_at: now.toISOString(),
      acknowledged_at: now.toISOString(),
    });
  });

  it('sends each once, however often the job runs', async () => {
    const { ctx, sent } = context(BOTH);

    await sendInquiryEmails({ inquiryId: 'inq-1' }, ctx, now);
    await sendInquiryEmails({ inquiryId: 'inq-1' }, ctx, now);

    expect(sent).toHaveLength(2);
  });

  it('fails when an email cannot be handed over, and sends only what is missing the next time', async () => {
    const sent: string[] = [];
    let buyerFails = true;
    const { ctx } = context(BOTH, async (message) => {
      if (message.to === 'ada@buyer.example' && buyerFails) {
        throw new Error('the mail queue is down');
      }
      sent.push(message.to);
      return 'job';
    });

    // Mallok runs a job that throws again.
    await expect(
      sendInquiryEmails({ inquiryId: 'inq-1' }, ctx, now),
    ).rejects.toThrow('the mail queue is down');
    expect(await marks()).toEqual({
      notified_at: now.toISOString(),
      acknowledged_at: null,
    });

    buyerFails = false;
    await sendInquiryEmails({ inquiryId: 'inq-1' }, ctx, now);

    // The seller was not told twice.
    expect(sent).toEqual(['sales@seller.example', 'ada@buyer.example']);
  });

  it('does not mark an email it could not hand over', async () => {
    const { ctx } = context(BOTH, async () => {
      throw new Error('down');
    });

    await expect(
      sendInquiryEmails({ inquiryId: 'inq-1' }, ctx, now),
    ).rejects.toThrow('down');

    expect(await marks()).toEqual({ notified_at: null, acknowledged_at: null });
  });

  it('writes to nobody about what the seller has called spam', async () => {
    await db()
      .prepare("UPDATE p_shop_inquiry SET status = 'spam' WHERE id = 'inq-1'")
      .run();
    const { ctx, sent } = context({ inquiry_acknowledge: true });

    await sendInquiryEmails({ inquiryId: 'inq-1' }, ctx, now);

    expect(sent).toEqual([]);
  });

  it('sends nothing when nobody is to be told', async () => {
    const { ctx, sent } = context({});

    await sendInquiryEmails({ inquiryId: 'inq-1' }, ctx, now);

    expect(sent).toEqual([]);
    expect(await marks()).toEqual({ notified_at: null, acknowledged_at: null });
  });

  it.each([
    ['an inquiry that was never stored', { inquiryId: 'nobody' }],
    ['a payload that names none', {}],
    ['a payload that is not an object', 'inq-1'],
    ['no payload', null],
  ])('finds nothing to send for %s', async (_what, payload) => {
    const { ctx, sent } = context(BOTH);

    await sendInquiryEmails(payload, ctx, now);

    expect(sent).toEqual([]);
  });
});

describe('an inquiry’s emails, through Mallok’s own queue', () => {
  const SHOP = '/_mallok/p/shop';

  beforeAll(ensureSite);
  beforeEach(clearShopTables);

  it('are owed from the moment the cart is sent, and handed over on the next tick', async () => {
    const settings = await api('PATCH', '/_mallok/api/plugins/shop/settings', {
      buffer_rate: 0.03,
      recalc_threshold: 0.02,
      rounding: 'ending99',
      inquiry_recipient: 'sales@seller.example',
      inquiry_acknowledge: false,
    });
    expect(settings.ok).toBe(true);
    const product = await createProduct({
      title: 'Queued screw',
      slug: 'queued-screw',
    });
    await createVariant({
      id: 'q-1',
      productGroup: product.translationGroup,
      sku: 'Q-1',
    });
    await setPrice({
      variantId: 'q-1',
      currency: 'USD',
      amountMinor: 100,
      source: 'base',
    });
    const form = (
      path: string,
      fields: Record<string, string>,
      cookie?: string,
    ) =>
      SELF.fetch(`${ORIGIN}${SHOP}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          ...(cookie === undefined ? {} : { cookie }),
        },
        body: new URLSearchParams(fields).toString(),
        redirect: 'manual',
      });
    const added = await form('/cart/update', { variant: 'q-1', quantity: '1' });
    const cookie = added.headers.get('set-cookie')?.split(';')[0] ?? '';
    await form(
      '/cart/inquiry',
      { name: 'Ada', email: 'ada@buyer.example' },
      cookie,
    );
    const before = await db()
      .prepare('SELECT notified_at FROM p_shop_inquiry')
      .first<{ notified_at: string | null }>();
    expect(before).toEqual({ notified_at: null });

    // Mallok's once-a-minute tick, which is what runs a plugin's jobs.
    const execution = createExecutionContext();
    await worker.scheduled?.(
      createScheduledController({ scheduledTime: Date.now() + 1000 }),
      env as never,
      execution,
    );
    await waitOnExecutionContext(execution);

    const after = await db()
      .prepare('SELECT notified_at FROM p_shop_inquiry')
      .first<{ notified_at: string | null }>();
    expect(after?.notified_at).toMatch(/^\d{4}-\d\d-\d\dT/);
    // The seller's email is Mallok's to deliver now: one of its own jobs.
    const mail = await db()
      .prepare(
        "SELECT COUNT(*) AS n FROM job WHERE payload LIKE '%sales@seller.example%'",
      )
      .first<{ n: number }>();
    expect(mail?.n).toBe(1);
    // And the shop's own job is finished: it is not run again.
    const own = await db()
      .prepare("SELECT status FROM job WHERE type LIKE '%inquiry_emails%'")
      .all<{ status: string }>();
    expect(own.results).toEqual([{ status: 'done' }]);
  });
});
