# Phase 5: order management and transactional email — implementation record

> A record written after the fact, from the code and the commit history.

**Spec:** `docs/superpowers/specs/2026-09-03-nundar-design.md`, sections 6.4 and 7.2

**Commit:** `6731e3a`

---

## Order management

The admin's order screens exist to make the state machine operable by a person,
without letting that person break it.

**The available actions come from the state machine.** A button is only rendered
if the transition it performs is legal from the order's current state. The server
refuses illegal transitions regardless, but nobody should have to click to find
that out.

### Shipping

Recording a tracking number and advancing the state are one action, because
"shipped" without a tracking number helps neither support nor the buyer. The
number is required.

**A shipping notice that cannot be sent does not fail the shipment.** The goods
have already gone out; rolling back the state because an email bounced would put
the database at odds with physical reality. The failure is logged and the order
stays shipped.

### Refunds

Stripe first, local state second. If the refund fails at Stripe, nothing changes
locally — the books never claim money was returned that was not.

**Returning stock follows `inventory_adjustments`, not the order status.** An
`oversold` order never actually took stock, so returning it would conjure
inventory out of nothing. The rollback replays what was actually recorded rather
than what the order implies. This is the kind of asymmetry that only shows up
once you have a state that looks paid but never decremented.

## Transactional email

Through the Cloudflare Email binding rather than the REST API, so the Worker
holds no API token.

### It never throws

A notification that cannot be delivered must not roll back placing or shipping an
order. The money has moved and the order has changed; failing the whole operation
over a failed notice is strictly worse for the buyer than the missing email.
Callers log or alert on the returned result.

In the webhook this matters twice over: returning 5xx because an email failed
would make Stripe redeliver an event that was already handled correctly, turning
a missing email into duplicated processing.

### Both parts, always

Every message carries a text and an HTML part. HTML alone renders blank in some
clients and pushes up the spam score.

Product names come from the database and are escaped before reaching HTML.

### Language

Orders record the language they were placed in, and notifications go out in it.
This is why `orders.locale` exists as a column rather than being derived — the
buyer's language at the moment of purchase is a fact about the order, and
deriving it later from a cookie or a header would get it wrong.

### No PII in logs

The recipient address never reaches the logs. Order failures log an order id and
nothing else.

## Sending domain

Cloudflare Email Sending requires the sending domain to be enabled first:

```bash
npx wrangler email sending enable yourdomain.com
```

The domain's DNS must be on Cloudflare. Until this is done, mail does not leave —
and because sending never throws, it fails quietly. The README calls this out as
a required post-deploy step for exactly that reason.

**Not verified.** This is blocked on a real domain, along with the Stripe webhook
URL and `NEXT_PUBLIC_SITE_URL`.

## Customer records

Read-only in the admin: the customer list, their order history, their address
book.

Lifetime spend is grouped by currency and never summed, for the same reason as
the dashboard — a figure adding USD to EUR is not a smaller truth, it is not a
truth at all. Only paid orders count as spend; pending and cancelled do not. The
order *count* still includes everything, because cancelled orders are something
the operator needs to see.

A malformed stored address is tolerated rather than allowed to make the order
page unopenable. Support needs to read the order more than it needs the address
to parse.

## What was deliberately not built

**Customer-facing accounts.** The spec lists them, and the schema has
`customers` and `customer_addresses` with a `password_hash`. The storefront
checkout is guest-only: no forced account creation, order tracking by order
number.

Forcing account creation before a first purchase is a well-documented way to
lose the purchase, and for a catalogue where buyers order occasionally and in
volume, an account earns its place only once there is a reorder flow worth
signing in for. The tables are there so adding it later needs no migration.

This is the largest gap between the spec and what shipped, and it is a choice
rather than an oversight.
