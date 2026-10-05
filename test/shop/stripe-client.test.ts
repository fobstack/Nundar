import { describe, expect, it } from 'vitest';
import {
  createCheckoutSession,
  createRefund,
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

const SESSION = {
  amountMinor: 99_000,
  currency: 'USD' as const,
  orderId: 'order-1',
  orderNo: 'ND-261005-7K3M9QXA',
  productName: 'Order ND-261005-7K3M9QXA',
  successUrl: 'https://shop.example/ok',
  cancelUrl: 'https://shop.example/cart',
};

describe('createCheckoutSession', () => {
  it('charges the server-computed total as a single line item', async () => {
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
    expect(body.get('line_items[0][price_data][unit_amount]')).toBe('99000');
    expect(body.get('line_items[0][price_data][currency]')).toBe('usd');
    expect(body.get('line_items[0][quantity]')).toBe('1');
    expect(session).toEqual({
      id: 'cs_1',
      url: 'https://checkout.stripe.com/c/pay/cs_1',
    });
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

    for (const amountMinor of [0, -100, 99.5, Number.NaN]) {
      await expect(
        createCheckoutSession('sk_test_123', { ...SESSION, amountMinor }, impl),
      ).rejects.toThrow(/positive amount/);
    }
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
