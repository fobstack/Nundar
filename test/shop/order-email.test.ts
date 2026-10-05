import { describe, expect, it } from 'vitest';
import {
  orderConfirmationEmail,
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
