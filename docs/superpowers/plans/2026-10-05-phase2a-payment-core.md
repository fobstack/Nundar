# Phase 2A: the payment core

> Date: 2026-10-05
> Design: `docs/superpowers/specs/2026-09-30-nundar-on-mallok-design.md` §4.2, §5.4, §8, §14
> Builds on: `mallok@0.1.0-rc.9`

## Goal

Phase 1B waits for extension points Mallok has not released. This phase builds the part of phase 2 that needs none of them: everything about orders and payment that is logic and data, with no route, no page and no admin screen.

It finishes the port list in the design's §8. **Nothing in the deployed Worker calls this code yet.** The Worker's bundle grows by the migration's text and nothing else.

## What was built

**The tables (`migrations/0002_orders.sql`)**
- `p_shop_order`, `p_shop_order_line`, `p_shop_stripe_event`, `p_shop_stock_adjustment`, `p_shop_outbox`.
- By constraint: an order's total is the sum of its parts; money is stored as whole numbers; one payment intent belongs to one order; one payment is recorded once whatever its event id; an order has one line per variant; a stock movement an order causes can be written once; a duty in the outbox can be written once.

**Orders (`lib/orders.ts`)**
- `createPendingOrder`: the order and its line snapshots in one batch, one round trip. Stock is not touched.
- `getOrder`: by id or by order number, with lines, in one round trip.
- `markOrderPaid`: the event, the stock, the ledger, the outbox row and the order's status in one batch. Two round trips whatever the number of lines. Safe to call any number of times, at any moment, for the same payment. Its outcome is one of `paid`, `oversold`, `refused` and `duplicate`.

**After the order (`lib/order-fulfilment.ts`)**
- `shipOrder`, `markDelivered`, `cancelOrder`, `refundOrder`. Each is checked against the state machine and written only if the order is still where it was read.
- A refund returns what the ledger says the payment took, in the same batch that marks the order refunded.

**The outbox (`lib/outbox.ts`, `lib/order-guard.ts`)**
- Every batch that changes an order writes a row saying so, under the same condition as the rest of the batch. A payment the order could not take writes one naming the payment to refund.
- Reading what is owed, and marking it handled. Nothing drains it yet.

**Availability (`lib/availability.ts`)**
- A variant's state — in stock, made to order, out of stock — and which products changed state between two readings. A payment and a refund both report it, for the purge the design's §5.1 asks for.

**Stripe (`lib/stripe-signature.ts`, `lib/stripe-client.ts`, `lib/stripe-webhook.ts`)**
- Signature verification on WebCrypto.
- Opening a hosted Checkout session and refunding a payment, over `fetch`.
- The webhook's decision: given the raw body, the signature header and the secret, what happened and which status to answer with.

**Email (`lib/order-email.ts`)**
- The payment confirmation and the shipping notice, in English, German, French and Spanish, each with a plain-text part.

## How it was verified

| Check | Result |
|---|---|
| `npm run lint`, `npm run typecheck` | Pass |
| `npm run test:project` | 10 of 10 |
| `npm run test:shop` | 272 of 272, inside workerd; 142 of them new |
| `npm run build` | Pass |
| `npm run smoke`, `npm run smoke:shop` | Pass, on a real local Worker, with the new migration applied by Mallok's migrator |

The tests were written first and seen to fail before any of the code existed.

Then every guard was broken, one at a time, to see whether a test noticed: 92 mutations, 92 caught. Among them the ones that only show when two calls run at the same moment — the status condition on the stock decrement, on a refund's restock and on a status change. Those being caught is what shows the parallel tests really interleave.

Then the code went to an independent reviewer, who was given the properties it must hold and not how it holds them. The five defects that came back are in the design's §14, each fixed with a test that fails without the fix.

## What implementation uncovered

**About the previous code**
- A crash between its stock decrement and its order update left stock taken for an order still marked unpaid; the redelivery then took it again.
- Two near-simultaneous deliveries of one event could both pass its "already processed" check and both decrement.
- A second event for a payment already recorded was refused and answered 5xx, which Stripe retries for three days.
- A payment without an order id answered 400, so every payment the same Stripe account took elsewhere would be redelivered.
- Its six-character order numbers would collide about once a month at a thousand orders a day.
- Its confirmation template could state a lead time, and nothing supplied one.

**About this code, from the independent review**
- A return value is not a place to keep a duty. "This call paid the order, so send the email" is lost whenever the Worker stops after the batch, or the batch's answer does not come back. The duty has to be a row in the same batch.
- "Fail loudly" is the wrong reflex for a webhook. Loud, to Stripe, means three days of redelivery; for anything a retry cannot change, the right kind of loud is a record a person will find.
- A reading is stale by the time it is acted on. The oversold write trusted a reading of the stock that another order's refund could overturn.
- A check on a product is not a check on its factors: 99.5 × 10 is a whole number.

**About D1 and workerd**
- `UPDATE … RETURNING` and `INSERT … SELECT … WHERE … RETURNING` work inside a batch, and are how a statement reports that it matched: clearer than counting changes.
- A batch may hold reads beside its writes. The stock before and after a payment is read in the payment's own transaction, so the report of what changed cannot be skewed by another order.
- An `INTEGER` column stores 99.5 as a real number. Only a `typeof` check refuses it.
- WebCrypto refuses an HMAC key of length zero with a `DataError`. An unset signing secret is refused before that, with a reason.

**About Mallok**
- The core builds a product's structured data itself and emits it in `page.head`, and a theme cannot add a JSON-LD block. The render-data hook Mallok plans puts a price on the page; nothing yet lets a plugin put it in the structured data. Added to the list for Mallok (design §7).
- A job a plugin enqueues through Mallok would be a second write, after the plugin's own batch. Unless the enqueue can join that batch, a plugin whose follow-up must not be lost needs an outbox of its own. Noted for Mallok's job API (design §7, API-8).
- Mallok's own plugin builds its emails in code with `escapeHtml`, with operator overrides in settings. The order emails follow that, rather than the Liquid templates the design first named.
- Site-level email settings are being added in Mallok and are not released. The order emails need them, or a key of the plugin's own, before anything is sent.

## What waits

**For Mallok**
- The webhook route: a raw-body route (design §7 API-5).
- The checkout, cart and order pages: plugin pages through the theme (API-3, API-4).
- Order handling in the admin: actions with parameters and related rows (API-6).
- Purging on an availability change: plugin cache tags (API-2).

**For a decision** — listed in the design's §14, none decided here: who drains the outbox and who is told; a payment for a cancelled order; orders never paid; orders that cost nothing; Stripe's Adaptive Pricing; cross-checking the amount; emptying the cart; how a refund is ordered and whether it restocks a shipped order; `oversold → cancelled`; pinning the Stripe API version; email settings; the order-number prefix.

**For a real account**
- A Stripe test-mode purchase end to end.
- CPU time and D1 usage of a payment on the Workers Free plan.
