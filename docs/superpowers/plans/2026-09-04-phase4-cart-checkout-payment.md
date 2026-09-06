# Phase 4: cart, checkout and payment — implementation record

> A record written after the fact, from the code and the commit history. See the
> note at the top of the phase 3 record for why these read differently from
> phases 1 and 2.

**Spec:** `docs/superpowers/specs/2026-09-03-nundar-design.md`, section 6

**Commits:** `37c43df`, `b128656`, and the hardening in `999deca`

---

## The one rule this phase exists to enforce

**No amount supplied by a client is ever trusted.**

Everything below is a consequence of it. The cart stores no prices. Checkout
recomputes from the database. The PaymentIntent amount comes from that
recomputation. The webhook, not the browser, decides that an order was paid.

## The cart

A guest cart lives in KV under a random, unguessable id held in an HttpOnly
cookie, with a 30-day TTL. The id is the only credential protecting a cart, so
it has to be unguessable — there is nothing else standing between one visitor
and another's cart.

**It stores variant ids and quantities. Never prices.** A stored price is a
price the client can eventually influence; a recomputed price is not. Every
total is derived at checkout from current database values.

Malformed entries are dropped rather than failing the whole cart page. A per-line
quantity ceiling rejects volumes no real order reaches, because anything above
it is scripted.

## Pricing a cart

`priceCart` is the single authoritative calculation before payment. Price, stock
and MOQ are all re-read there.

Two decisions that look small and are not:

**Every problem is returned at once.** Reporting one error at a time means a
buyer fixes the quantity, resubmits, and learns the item is out of stock —
then fixes that and learns about the MOQ. Each round trip is a chance to
abandon.

**Currency falls back for the whole order, never per line.** If any line lacks a
price in the requested currency, the entire order falls back to the base
currency and says so. Mixing two currencies inside one order produces a total
that means nothing, and charging a dollar amount in euros is never acceptable.

## Payment

Stripe over REST with `fetch`, no SDK. The official Node SDK needs adapting for
Workers, and this project uses two endpoints — create a PaymentIntent, and
refund one. Calling REST directly costs fewer dependencies and gives more
control, which matters more for a template other people fork than it would for
an application.

An idempotency key on creation means a retry does not charge twice. Neither the
key nor the full response is ever written into an error, because errors reach
logs.

### Hosted Checkout instead of Elements

The spec called for Stripe Elements. Elements needs `@stripe/stripe-js` and
`@stripe/react-stripe-js`; hosted Checkout needs neither, and card details stay
off our servers either way. The cost is that the buyer leaves for stripe.com,
which weakens brand continuity.

This is an open decision, recorded in the spec's divergence section.

**The detail that breaks everything if missed:** `order_id` must go into
`payment_intent_data.metadata`. Without it, a `payment_intent.succeeded` webhook
cannot be matched back to an order, and every payment silently strands.

## The webhook

This is the only trustworthy source of order status. Browsers crash and
connections drop right after payment constantly, so a client-side "payment
succeeded" callback cannot be relied on.

**Signature verification** is HMAC-SHA256 through WebCrypto, no SDK. The raw
body must be read *before* parsing: parsing and re-serialising the JSON changes
the bytes and the signature stops matching. Comparison is constant-time. During
a secret rotation Stripe sends several `v1` signatures and any match passes. A
timestamp window blocks replay.

A failed signature is a 400 with no retry — that is not a transient fault, it is
either a forgery or a misconfiguration, and retrying either is pointless.

**Idempotency** is the `stripe_events.event_id` primary key. Stripe redelivers,
and processing one event twice would decrement stock twice. A redelivery reports
the current status and changes nothing.

Events we do not handle still return 200. A non-2xx would make Stripe redeliver
them forever.

## Stock

**Decremented after payment confirms, never at add-to-cart or order creation.**
Decrementing earlier lets anyone drain the catalogue with scripted orders that
are never paid for.

The decrement is a conditional update — `WHERE stock >= qty` — so it cannot go
negative. D1 has no transaction spanning these statements, so when one line
succeeds and a later one fails, the successful ones are compensated by hand.

When the stock is genuinely gone, the order becomes `oversold`: paid, but
unfulfillable. It goes to a manual queue for refund and **must never ship**. The
webhook still returns 200, because the event was handled correctly — the problem
is inventory, not delivery.

The trade is explicit and was made deliberately: a small chance of overselling
followed by a refund beats having stock held hostage by anyone with a script.
The rejected alternative — reserving stock for fifteen minutes at order creation
— needs an additional cleanup job and more moving parts.

## Order state

```
pending ──→ paid ──→ shipped ──→ delivered
   │          │          │
   │          └──────────┴──→ refunded
   ├──→ cancelled
   └──→ oversold
```

Only these transitions are permitted; anything else is refused at the data
access layer. Letting status be rewritten freely is where commerce systems bury
their reconciliation incidents — shipping before payment clears, or marking a
refunded order delivered.

Order lines are snapshots of name, SKU and unit price. Renaming, repricing or
delisting a product later must not change what a historical order says it was,
which finance and support both depend on.

Order numbers are a date plus a random suffix, so they leak no order volume.

## Rate limiting (added in `999deca`)

Checkout is the most expensive public endpoint: every call writes an order and
opens a Stripe session. Unlimited, it can be used to bloat D1, exhaust the
Stripe quota, and run up a real bill.

Limits are counted against `cf-connecting-ip`, which Cloudflare sets at the edge
and a client cannot forge. **`x-forwarded-for` is explicitly ignored** — keying a
limit on a header the caller controls lets an attacker pick their own bucket and
walk straight past it.

Fixed windows rather than sliding: KV has no atomic increment, and a sliding
window needs a read-modify-write across several keys, which is expensive at the
edge and still not atomic. A fixed window allows roughly a double burst at the
boundary, which is fine for the actual goal of stopping automation.

| Endpoint | Budget | Why |
|---|---|---|
| checkout | 10 / 10 min | Creates orders and calls Stripe |
| cart | 120 / min | Normal, frequent, cheap |
| order status | 60 / min | The success page polls every 3s for up to 2 min |
| inventory | 120 / min | One call per product page load |

## The success page

The webhook races the buyer's return from Stripe, and the buyer usually wins.
The page shows "processing" and polls for up to two minutes rather than claiming
either success or failure — both of which would sometimes be lies.

The status endpoint returns the order number and status only. No amounts, no
addresses. Order numbers are enumerable, and the rate limit is what makes
probing them expensive.

## The gap this phase shipped with, since fixed

**The transactional path was not translated.** `AddToCart`, the cart view, the
checkout form and the order status component all carried hardcoded English, in
all four languages. A French buyer read French product content and French
application notes, then hit "Add to cart", "Your cart is empty" and "Subtotal"
in English at exactly the moment they were about to pay. The browser tab said
"Cart" too.

It survived this long because the SEO content — the part that gets reviewed —
was perfectly multilingual, and nobody walks the checkout in a language they do
not read. It was found while building a second theme, which forced an audit of
every string the storefront renders.

Fixed in `0f68be1`, against the shared catalogue in
`src/lib/storefront/i18n.ts`. The page titles needed `generateMetadata`, since a
static `metadata` export cannot see the locale.
