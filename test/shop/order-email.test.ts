import { describe, expect, it } from 'vitest';
import {
  cancellationEmail,
  orderConfirmationEmail,
  refundNotificationEmail,
  sellerNewOrderEmail,
  sellerOversoldEmail,
  sellerRefundOwedEmail,
  shippingNotificationEmail,
} from '../../src/plugins/shop/lib/order-email.js';

const ORDER = {
  orderNo: 'ND-261005-7K3M9QXA',
  currency: 'USD' as const,
  totalMinor: 99_000,
  locale: 'en',
  lines: [
    {
      variantId: 'dn50',
      name: 'Stainless Steel Ball Valve DN50',
      sku: 'BV-316L-DN50-NPT',
      quantity: 10,
      unitPriceMinor: 9900,
    },
  ],
  leadTimeDaysMax: 20,
};

describe('orderConfirmationEmail', () => {
  const mail = orderConfirmationEmail(ORDER);

  it('puts the order number in the subject, so a reply can be traced', () => {
    expect(mail.subject).toBe('Order ND-261005-7K3M9QXA confirmed');
  });

  it('always carries a plain-text part beside the HTML', () => {
    // HTML alone renders blank in some clients and raises the spam score.
    expect(mail.text.length).toBeGreaterThan(0);
    expect(mail.html.length).toBeGreaterThan(0);
  });

  it('lists each line with its quantity and its money, formatted', () => {
    expect(mail.text).toContain(
      '- Stainless Steel Ball Valve DN50 (BV-316L-DN50-NPT) × 10 — $990.00',
    );
    expect(mail.html).toContain('Stainless Steel Ball Valve DN50');
    expect(mail.html).toContain('$990.00');
  });

  it('states the total in the order’s own currency', () => {
    expect(mail.text).toContain('Total: $990.00');
  });

  it('tells the buyer the lead time when there is one to tell', () => {
    expect(mail.text).toContain('Expected to ship within 20 business days.');
    expect(mail.html).toContain('Expected to ship within 20 business days.');
  });

  it('says nothing about lead time when none can be promised', () => {
    const silent = orderConfirmationEmail({ ...ORDER, leadTimeDaysMax: null });

    expect(silent.text).not.toMatch(/business days/);
    expect(silent.html).not.toMatch(/business days/);
  });

  it('writes in the language the order was placed in', () => {
    expect(orderConfirmationEmail({ ...ORDER, locale: 'de' }).subject).toBe(
      'Bestellung ND-261005-7K3M9QXA bestätigt',
    );
    expect(orderConfirmationEmail({ ...ORDER, locale: 'fr' }).subject).toBe(
      'Commande ND-261005-7K3M9QXA confirmée',
    );
    expect(orderConfirmationEmail({ ...ORDER, locale: 'es' }).subject).toBe(
      'Pedido ND-261005-7K3M9QXA confirmado',
    );
  });

  it('uses the language of a regional variant, and English for one it has no text for', () => {
    expect(
      orderConfirmationEmail({ ...ORDER, locale: 'de-AT' }).subject,
    ).toMatch(/^Bestellung/);
    // A language without a translation gets English, and a locale that is
    // not even well-formed must not stop the email from being built.
    expect(orderConfirmationEmail({ ...ORDER, locale: 'ja' }).subject).toMatch(
      /^Order/,
    );
    expect(
      orderConfirmationEmail({ ...ORDER, locale: 'not a locale!' }).text,
    ).toContain('$990.00');
  });

  it('formats money the way the recipient’s language writes it', () => {
    const german = orderConfirmationEmail({
      ...ORDER,
      locale: 'de',
      currency: 'EUR',
    });

    expect(german.text).toMatch(/990,00\s€/);
  });

  it('escapes product names, so a crafted name cannot inject markup', () => {
    const [line] = ORDER.lines;
    if (line === undefined) {
      throw new Error('The fixture order has no line');
    }
    const nasty = orderConfirmationEmail({
      ...ORDER,
      lines: [
        { ...line, name: '<script>alert("x")</script>', sku: '"><img src=x>' },
      ],
    });

    expect(nasty.html).not.toContain('<script>');
    expect(nasty.html).not.toContain('<img');
    expect(nasty.html).toContain('&lt;script&gt;');
    // The text part is not markup, so the name appears as it was written.
    expect(nasty.text).toContain('<script>alert("x")</script>');
  });
});

describe('shippingNotificationEmail', () => {
  const mail = shippingNotificationEmail({
    orderNo: 'ND-261005-7K3M9QXA',
    locale: 'en',
    trackingNo: 'TRACK123456',
  });

  it('names the order in the subject', () => {
    expect(mail.subject).toBe('Order ND-261005-7K3M9QXA has shipped');
  });

  it('carries the tracking number in both parts', () => {
    expect(mail.text).toContain('Tracking number: TRACK123456');
    expect(mail.html).toContain('TRACK123456');
  });

  it('leaves the tracking line out when there is no tracking number', () => {
    const without = shippingNotificationEmail({
      orderNo: 'ND-1',
      locale: 'en',
      trackingNo: null,
    });

    expect(without.text).not.toMatch(/tracking number/i);
    expect(without.html).not.toMatch(/tracking number/i);
    expect(without.text).toContain('Your order is on its way.');
  });

  it('is written in the order’s language', () => {
    const german = shippingNotificationEmail({
      orderNo: 'ND-1',
      locale: 'de',
      trackingNo: 'T1',
    });

    expect(german.subject).toBe('Bestellung ND-1 wurde versandt');
    expect(german.text).toContain('Sendungsnummer: T1');
  });

  it('escapes the tracking number in the HTML part', () => {
    // It is typed by a person in the admin, and it ends up in a buyer's inbox.
    const nasty = shippingNotificationEmail({
      orderNo: 'ND-1',
      locale: 'en',
      trackingNo: '<b>T1</b>',
    });

    expect(nasty.html).not.toContain('<b>T1</b>');
    expect(nasty.html).toContain('&lt;b&gt;T1&lt;/b&gt;');
  });
});

describe('the confirmation, with what checkout knows', () => {
  const full = orderConfirmationEmail(
    {
      ...ORDER,
      subtotalMinor: 99_000,
      shippingMinor: 4900,
      taxMinor: 0,
      totalMinor: 103_900,
      company: 'Engines & <Sons>',
      shippingAddress: {
        recipient: 'Ada <b>Lovelace</b>',
        line1: '1 Harbour Road',
        city: 'Aberdeen',
        postalCode: 'AB11 5RY',
        country: 'GB',
      },
    },
    'https://shop.example/_mallok/p/shop/order/ND-261005-7K3M9QXA?k=abc',
  );

  it('states the goods and the shipping as well as the total, and no tax line for none', () => {
    expect(full.text).toContain('Subtotal: $990.00');
    expect(full.text).toContain('Shipping: $49.00');
    expect(full.text).toContain('Total: $1,039.00');
    expect(full.text).not.toContain('Tax:');
  });

  it('says where the order goes, the country by name', () => {
    expect(full.text).toContain(
      'Shipping to:\nAda <b>Lovelace</b>\nEngines & <Sons>\n1 Harbour Road\nAB11 5RY Aberdeen\nUnited Kingdom',
    );
    expect(full.html).toContain('Ada &lt;b&gt;Lovelace&lt;/b&gt;');
    expect(full.html).toContain('Engines &amp; &lt;Sons&gt;');
    expect(full.html).not.toContain('<b>Lovelace</b>');
  });

  it('carries the buyer’s link to their order', () => {
    expect(full.text).toContain(
      'See your order: https://shop.example/_mallok/p/shop/order/ND-261005-7K3M9QXA?k=abc',
    );
    expect(full.html).toContain(
      '<a href="https://shop.example/_mallok/p/shop/order/ND-261005-7K3M9QXA?k=abc">See your order</a>',
    );
  });

  it('links nothing that is not a web address', () => {
    const odd = orderConfirmationEmail(ORDER, 'javascript:alert(1)');
    expect(odd.html).not.toContain('javascript:');
  });
});

describe('the shipping notice, with a carrier', () => {
  it('names the carrier beside the tracking number', () => {
    const mail = shippingNotificationEmail({
      orderNo: 'ND-1',
      locale: 'fr',
      trackingNo: '1Z999',
      carrier: 'UPS',
    });

    expect(mail.text).toContain('Transporteur: UPS\nNuméro de suivi: 1Z999');
  });
});

describe('refundNotificationEmail', () => {
  it('says how much went back, in the order’s language and money', () => {
    const mail = refundNotificationEmail({
      orderNo: 'ND-1',
      locale: 'de',
      currency: 'EUR',
      totalMinor: 94_500,
    });

    expect(mail.subject).toBe('Bestellung ND-1 erstattet');
    expect(mail.text).toContain('Wir haben 945,00');
  });
});

describe('cancellationEmail', () => {
  it('says the order was cancelled and nothing was charged', () => {
    const mail = cancellationEmail({ orderNo: 'ND-1', locale: 'es' });

    expect(mail.subject).toBe('Pedido ND-1 cancelado');
    expect(mail.text).toContain('No se le ha cobrado nada.');
  });
});

describe('the seller’s notices', () => {
  const ORDER_FOR_SELLER = {
    orderNo: 'ND-261031-7K3M9QXA',
    currency: 'USD' as const,
    subtotalMinor: 99_000,
    shippingMinor: 4900,
    taxMinor: 0,
    totalMinor: 103_900,
    email: 'ada@buyer.example',
    company: 'Engines & <Sons>',
    taxId: 'GB123',
    shippingZone: 'United Kingdom',
    shippingAddress: {
      recipient: 'Ada',
      line1: '1 Road',
      city: 'Aberdeen',
      country: 'GB',
    },
    lines: ORDER.lines,
  };

  it('names a new order and its total, with what it holds and who bought it', () => {
    const mail = sellerNewOrderEmail(ORDER_FOR_SELLER);

    expect(mail.subject).toBe('New order ND-261031-7K3M9QXA — $1,039.00');
    expect(mail.text).toContain('Buyer: ada@buyer.example');
    expect(mail.text).toContain('Tax number: GB123');
    expect(mail.text).toContain('Shipping zone: United Kingdom');
    expect(mail.html).toContain('Engines &amp; &lt;Sons&gt;');
  });

  it('asks for an oversold order to be refunded or restocked', () => {
    const mail = sellerOversoldEmail(ORDER_FOR_SELLER);

    expect(mail.subject).toBe(
      'Order ND-261031-7K3M9QXA was paid for, and the stock had gone',
    );
    expect(mail.text).toContain('either refund it, or restock and fulfil it');
  });

  it.each([
    ['cancelled', 'the order had been cancelled'],
    ['already_paid', 'another payment had already settled the order'],
    ['amount_mismatch', "did not come to the order's total"],
  ] as const)(
    'asks for a payment to be refunded and says why: %s',
    (because, words) => {
      const mail = sellerRefundOwedEmail({
        orderNo: 'ND-1',
        paymentIntentId: 'pi_9',
        because,
      });

      expect(mail.subject).toBe('A payment for order ND-1 has to be refunded');
      expect(mail.text).toContain(words);
      expect(mail.text).toContain('Payment: pi_9');
    },
  );
});
