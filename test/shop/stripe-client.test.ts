import { describe, expect, it } from 'vitest';
import {
  createCheckoutSession,
  createRefund,
  createTaxCustomer,
  expireCheckoutSession,
  STRIPE_API_VERSION,
} from '../../src/plugins/shop/lib/stripe-client.js';

interface Captured {
  readonly url: string;
  readonly init: RequestInit;
}

/** A `fetch` that records what it was asked and answers with fixed JSON. */
function recordingFetch(response: unknown, status = 200) {
  const calls: Captured[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(response), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;

  return { impl, calls };
}

function only(calls: readonly Captured[]): Captured {
  const [call] = calls;
  if (call === undefined || calls.length !== 1) {
    throw new Error(`Expected one request, saw ${calls.length}`);
  }
  return call;
}

function bodyOf(call: Captured): URLSearchParams {
  return new URLSearchParams(String(call.init.body));
}

function headersOf(call: Captured): Record<string, string> {
  return call.init.headers as Record<string, string>;
}

const EXPIRES = new Date('2026-10-31T09:00:00.000Z');

const SESSION = {
  currency: 'USD' as const,
  orderId: 'order-1',
  orderNo: 'ND-261005-7K3M9QXA',
  lines: [
    {
      name: 'Hex bolt M8',
      sku: 'HB-M8',
      unitPriceMinor: 990,
      quantity: 100,
    },
    {
      name: 'Flange nut M8',
      sku: 'FN-M8',
      unitPriceMinor: 45,
      quantity: 17,
    },
  ],
  shipping: { label: 'Europe', amountMinor: 2500 },
  successUrl: 'https://shop.example/ok',
  cancelUrl: 'https://shop.example/cart',
  locale: 'de',
  expiresAt: EXPIRES,
};

describe('createCheckoutSession', () => {
  it('charges each line at the order’s own price, and shipping as one option', async () => {
    const { impl, calls } = recordingFetch({
      id: 'cs_1',
      url: 'https://checkout.stripe.com/c/pay/cs_1',
    });

    const session = await createCheckoutSession('sk_test_123', SESSION, impl);

    const call = only(calls);
    const body = bodyOf(call);
    expect(call.url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect(call.init.method).toBe('POST');
    expect(body.get('mode')).toBe('payment');
    expect(body.get('line_items[0][price_data][unit_amount]')).toBe('990');
    expect(body.get('line_items[0][price_data][currency]')).toBe('usd');
    expect(body.get('line_items[0][price_data][product_data][name]')).toBe(
      'Hex bolt M8 (HB-M8)',
    );
    expect(body.get('line_items[0][quantity]')).toBe('100');
    expect(body.get('line_items[1][price_data][unit_amount]')).toBe('45');
    expect(body.get('line_items[1][quantity]')).toBe('17');
    expect(body.has('line_items[2][quantity]')).toBe(false);
    expect(body.get('shipping_options[0][shipping_rate_data][type]')).toBe(
      'fixed_amount',
    );
    expect(
      body.get('shipping_options[0][shipping_rate_data][display_name]'),
    ).toBe('Europe');
    expect(
      body.get('shipping_options[0][shipping_rate_data][fixed_amount][amount]'),
    ).toBe('2500');
    expect(
      body.get(
        'shipping_options[0][shipping_rate_data][fixed_amount][currency]',
      ),
    ).toBe('usd');
    expect(session).toEqual({
      id: 'cs_1',
      url: 'https://checkout.stripe.com/c/pay/cs_1',
    });
  });

  it('charges in the shop’s currency, at once, and lapses when the order says', async () => {
    const { impl, calls } = recordingFetch({ id: 'cs_1', url: 'https://x' });

    await createCheckoutSession('sk_test_123', SESSION, impl);

    const body = bodyOf(only(calls));
    // Stripe's conversion would charge the buyer an amount the page never
    // showed.
    expect(body.get('adaptive_pricing[enabled]')).toBe('false');
    // Methods that settle at once only: a bank debit can take days, and the
    // stock is taken when the payment is.
    expect(body.getAll('allowed_payment_method_types[0]')).toEqual(['card']);
    expect(body.getAll('allowed_payment_method_types[1]')).toEqual(['link']);
    expect(body.has('allowed_payment_method_types[2]')).toBe(false);
    expect(body.get('expires_at')).toBe(
      String(Math.floor(EXPIRES.getTime() / 1000)),
    );
    expect(body.get('locale')).toBe('de');
    expect(body.get('client_reference_id')).toBe(SESSION.orderNo);
    expect(body.has('automatic_tax[enabled]')).toBe(false);
  });

  it('lets Stripe choose the page’s language for one the shop does not offer it in', async () => {
    const { impl, calls } = recordingFetch({ id: 'cs_1', url: 'https://x' });

    await createCheckoutSession(
      'sk_test_123',
      { ...SESSION, locale: 'xx' },
      impl,
    );

    expect(bodyOf(only(calls)).get('locale')).toBe('auto');
  });

  it('names the API version it was written against on every request', async () => {
    const session = recordingFetch({ id: 'cs_1', url: 'https://x' });
    const refund = recordingFetch({ id: 're_1', status: 'succeeded' });
    const customer = recordingFetch({ id: 'cus_1' });
    const expire = recordingFetch({ id: 'cs_1', status: 'expired' });

    await createCheckoutSession('sk_test_123', SESSION, session.impl);
    await createRefund('sk_test_123', { paymentIntentId: 'pi_1' }, refund.impl);
    await createTaxCustomer(
      'sk_test_123',
      {
        orderId: 'order-1',
        email: 'buyer@example.com',
        company: 'Acme GmbH',
        address: {
          recipient: 'Jane Buyer',
          line1: 'Hafenstraße 1',
          city: 'Hamburg',
          postalCode: '20457',
          country: 'DE',
        },
      },
      customer.impl,
    );
    await expireCheckoutSession('sk_test_123', 'cs_1', expire.impl);

    for (const calls of [
      session.calls,
      refund.calls,
      customer.calls,
      expire.calls,
    ]) {
      expect(headersOf(only(calls))['Stripe-Version']).toBe(STRIPE_API_VERSION);
    }
    expect(STRIPE_API_VERSION).toBe('2026-10-28.endive');
  });

  it('asks Stripe for tax on top of the prices only when given a customer to work it out from', async () => {
    const { impl, calls } = recordingFetch({ id: 'cs_1', url: 'https://x' });

    await createCheckoutSession(
      'sk_test_123',
      { ...SESSION, taxCustomerId: 'cus_1', customerEmail: 'b@example.com' },
      impl,
    );

    const body = bodyOf(only(calls));
    expect(body.get('automatic_tax[enabled]')).toBe('true');
    expect(body.get('customer')).toBe('cus_1');
    // The customer carries the email; sending both is not asked of Stripe.
    expect(body.has('customer_email')).toBe(false);
    expect(body.get('line_items[0][price_data][tax_behavior]')).toBe(
      'exclusive',
    );
    expect(body.get('line_items[1][price_data][tax_behavior]')).toBe(
      'exclusive',
    );
    expect(
      body.get('shipping_options[0][shipping_rate_data][tax_behavior]'),
    ).toBe('exclusive');
    expect(body.get('shipping_options[0][shipping_rate_data][tax_code]')).toBe(
      'txcd_92010001',
    );
  });

  it('refuses more lines than Checkout takes, and none', async () => {
    const { impl, calls } = recordingFetch({ id: 'cs_1', url: 'https://x' });
    const line = SESSION.lines[0];
    if (line === undefined) {
      throw new Error('fixture');
    }

    await expect(
      createCheckoutSession(
        'sk_test_123',
        { ...SESSION, lines: Array.from({ length: 101 }, () => line) },
        impl,
      ),
    ).rejects.toThrow(/1 to 100 lines/);
    await expect(
      createCheckoutSession('sk_test_123', { ...SESSION, lines: [] }, impl),
    ).rejects.toThrow(/1 to 100 lines/);
    expect(calls).toHaveLength(0);
  });

  it('puts the order id on the payment intent, which is what the webhook reads', async () => {
    const { impl, calls } = recordingFetch({ id: 'cs_1', url: 'https://x' });

    await createCheckoutSession(
      'sk_test_123',
      { ...SESSION, orderId: 'order-99', orderNo: 'ND-9' },
      impl,
    );

    // The webhook receives `payment_intent.succeeded`. Without the order id
    // in the intent's own metadata it could not find the order to mark paid.
    const body = bodyOf(only(calls));
    expect(body.get('payment_intent_data[metadata][order_id]')).toBe(
      'order-99',
    );
    expect(body.get('payment_intent_data[metadata][order_no]')).toBe('ND-9');
    expect(body.get('metadata[order_id]')).toBe('order-99');
  });

  it('keys idempotency on the order, so a double submit reuses the session', async () => {
    const { impl, calls } = recordingFetch({ id: 'cs_1', url: 'https://x' });

    await createCheckoutSession(
      'sk_test_123',
      { ...SESSION, orderId: 'order-3' },
      impl,
    );

    const headers = headersOf(only(calls));
    expect(headers['Idempotency-Key']).toBe('checkout:order-3');
    expect(headers.Authorization).toBe('Bearer sk_test_123');
  });

  it('prefills the buyer’s email only when one is given', async () => {
    const without = recordingFetch({ id: 'cs_1', url: 'https://x' });
    await createCheckoutSession('sk_test_123', SESSION, without.impl);
    expect(bodyOf(only(without.calls)).has('customer_email')).toBe(false);

    const withEmail = recordingFetch({ id: 'cs_1', url: 'https://x' });
    await createCheckoutSession(
      'sk_test_123',
      { ...SESSION, customerEmail: 'buyer@example.com' },
      withEmail.impl,
    );
    expect(bodyOf(only(withEmail.calls)).get('customer_email')).toBe(
      'buyer@example.com',
    );
  });

  it('names what Stripe refused by its identifiers, never by its free text', async () => {
    // The message is free text written for a person, and nothing says it
    // will not repeat a value that was sent. One of those is the buyer's
    // email address, and this text ends up in the logs.
    const { impl } = recordingFetch(
      {
        error: {
          type: 'invalid_request_error',
          code: 'email_invalid',
          param: 'customer_email',
          message: 'Invalid email address: buyer@example.com',
          request_log_url: 'https://dashboard.stripe.com/logs/req_secret',
        },
      },
      400,
    );

    const failure = await createCheckoutSession(
      'sk_test_123',
      { ...SESSION, customerEmail: 'buyer@example.com' },
      impl,
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(
      'Stripe: invalid_request_error, email_invalid, customer_email, status 400',
    );
  });

  it('leaves out anything in an error that is not shaped like an identifier', async () => {
    const { impl } = recordingFetch(
      {
        error: {
          type: 'api_error',
          code: 'not a code: buyer@example.com',
          param: { nested: 'object' },
        },
      },
      500,
    );

    await expect(
      createCheckoutSession('sk_test_123', SESSION, impl),
    ).rejects.toThrow(/^Stripe: api_error, status 500$/);
  });

  it('still says which status came back when Stripe explains nothing', async () => {
    const { impl } = recordingFetch({}, 500);

    await expect(
      createCheckoutSession('sk_test_123', SESSION, impl),
    ).rejects.toThrow(/^Stripe: status 500$/);
  });

  it('never asks Stripe to charge nothing, or a fraction of a minor unit', async () => {
    // A session for a total of zero creates no payment intent, so the event
    // that marks an order paid would never arrive.
    const { impl, calls } = recordingFetch({ id: 'cs_1', url: 'https://x' });

    const free = {
      ...SESSION,
      lines: [{ name: 'Sample', sku: 'S', unitPriceMinor: 0, quantity: 1 }],
      shipping: { label: 'Europe', amountMinor: 0 },
    };
    await expect(
      createCheckoutSession('sk_test_123', free, impl),
    ).rejects.toThrow(/positive amount/);
    for (const unitPriceMinor of [-100, 99.5, Number.NaN]) {
      await expect(
        createCheckoutSession(
          'sk_test_123',
          {
            ...SESSION,
            lines: [{ name: 'Bolt', sku: 'B', unitPriceMinor, quantity: 1 }],
          },
          impl,
        ),
      ).rejects.toThrow(/positive amount/);
    }
    for (const amountMinor of [-1, 2.5]) {
      await expect(
        createCheckoutSession(
          'sk_test_123',
          { ...SESSION, shipping: { label: 'Europe', amountMinor } },
          impl,
        ),
      ).rejects.toThrow(/positive amount/);
    }
    await expect(
      createCheckoutSession(
        'sk_test_123',
        {
          ...SESSION,
          lines: [
            { name: 'Bolt', sku: 'B', unitPriceMinor: 10, quantity: 1.5 },
          ],
        },
        impl,
      ),
    ).rejects.toThrow(/positive amount/);
    expect(calls).toHaveLength(0);
  });

  it('throws rather than crash when the answer is not JSON at all', async () => {
    // An outage page from a proxy in between is HTML, not Stripe's JSON.
    const impl = (async () =>
      new Response('<html>Bad gateway</html>', {
        status: 502,
      })) as unknown as typeof fetch;

    await expect(
      createCheckoutSession('sk_test_123', SESSION, impl),
    ).rejects.toThrow(/502/);
  });
});

describe('createRefund', () => {
  it('refunds against the payment intent', async () => {
    const { impl, calls } = recordingFetch({ id: 're_1', status: 'succeeded' });

    const refund = await createRefund(
      'sk_test_123',
      { paymentIntentId: 'pi_9' },
      impl,
    );

    const call = only(calls);
    expect(call.url).toBe('https://api.stripe.com/v1/refunds');
    expect(bodyOf(call).get('payment_intent')).toBe('pi_9');
    expect(bodyOf(call).has('reason')).toBe(false);
    expect(refund).toEqual({ id: 're_1', status: 'succeeded' });
  });

  it('keys idempotency on the payment intent, so a retry cannot refund twice', async () => {
    const { impl, calls } = recordingFetch({ id: 're_1', status: 'succeeded' });

    await createRefund(
      'sk_test_123',
      { paymentIntentId: 'pi_9', reason: 'requested_by_customer' },
      impl,
    );

    const call = only(calls);
    expect(headersOf(call)['Idempotency-Key']).toBe('refund:pi_9');
    expect(bodyOf(call).get('reason')).toBe('requested_by_customer');
  });
});

describe('createTaxCustomer', () => {
  it('gives Stripe the address the order ships to, keyed on the order', async () => {
    const { impl, calls } = recordingFetch({ id: 'cus_1' });

    const customer = await createTaxCustomer(
      'sk_test_123',
      {
        orderId: 'order-7',
        email: 'buyer@example.com',
        company: 'Acme GmbH',
        address: {
          recipient: 'Jane Buyer',
          line1: 'Hafenstraße 1',
          line2: '',
          city: 'Hamburg',
          region: 'HH',
          postalCode: '20457',
          country: 'DE',
        },
      },
      impl,
    );

    const call = only(calls);
    const body = bodyOf(call);
    expect(call.url).toBe('https://api.stripe.com/v1/customers');
    expect(headersOf(call)['Idempotency-Key']).toBe('customer:order-7');
    expect(body.get('email')).toBe('buyer@example.com');
    expect(body.get('name')).toBe('Acme GmbH');
    expect(body.get('shipping[name]')).toBe('Jane Buyer');
    expect(body.get('shipping[address][line1]')).toBe('Hafenstraße 1');
    expect(body.has('shipping[address][line2]')).toBe(false);
    expect(body.get('shipping[address][state]')).toBe('HH');
    expect(body.get('shipping[address][country]')).toBe('DE');
    expect(body.get('address[postal_code]')).toBe('20457');
    expect(body.get('metadata[order_id]')).toBe('order-7');
    expect(customer).toEqual({ id: 'cus_1' });
  });
});

describe('expireCheckoutSession', () => {
  it('expires the session so it can no longer be paid', async () => {
    const { impl, calls } = recordingFetch({ id: 'cs_1', status: 'expired' });

    expect(await expireCheckoutSession('sk_test_123', 'cs_1', impl)).toBe(
      'expired',
    );
    const call = only(calls);
    expect(call.url).toBe(
      'https://api.stripe.com/v1/checkout/sessions/cs_1/expire',
    );
    expect(headersOf(call)['Idempotency-Key']).toBe('expire:cs_1');
  });

  it('reports a session that is no longer open, rather than throwing', async () => {
    const { impl } = recordingFetch(
      {
        error: {
          type: 'invalid_request_error',
          code: 'checkout_session_not_open',
        },
      },
      400,
    );

    expect(await expireCheckoutSession('sk_test_123', 'cs_1', impl)).toBe(
      'not_open',
    );
  });

  it('throws for what a later try could change: a bad key, a limit, an outage', async () => {
    for (const status of [401, 429, 500, 503]) {
      const { impl } = recordingFetch({ error: { type: 'api_error' } }, status);
      await expect(
        expireCheckoutSession('sk_test_123', 'cs_1', impl),
      ).rejects.toThrow(new RegExp(`status ${status}`));
    }
  });
});
