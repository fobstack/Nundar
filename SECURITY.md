# Security Policy

## Reporting a vulnerability

**Do not open a public issue for a security problem.** Report it privately
through GitHub's [private vulnerability reporting][gh-private] on this
repository — that is the channel we monitor, and it keeps the report
confidential until a fix ships.

Include: what you found, how to reproduce it, and what an attacker could achieve.
A working proof of concept helps but is not required.

You will get an acknowledgement within 3 working days and an assessment within
10. If the report is valid we will agree a disclosure date with you before
publishing.

If what you found is in pages, sign-in, the admin, media or caching rather than
in the shop, it is most likely in [Mallok][mallok] — report it there.

[gh-private]: https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability
[mallok]: https://github.com/fobstack/mallok/blob/main/docs/SECURITY.md

## Supported versions

Nundar is self-deployed: you run your own copy. Security fixes land on `main`.
There are no backported release branches.

Nundar is in development and not yet fit to run a real shop; see the README.

## Where the trust boundaries are

Nundar is a plugin and a theme inside a Mallok site, and the boundary follows
that split.

**Mallok owns** administrator accounts and their passwords, sessions, CSRF
protection for the admin, the first-run setup key, API tokens, uploaded media,
content sanitisation, and the encryption of secrets a plugin stores. Its
security document describes each. Nundar implements none of them again.

**The shop plugin owns** what follows.

| Data | Where it lives | Notes |
|---|---|---|
| Card numbers, CVV | **Nowhere in Nundar** | Payment goes through Stripe's hosted checkout, so card data never reaches this code. A test lists the columns an order may have. No checkout route exists yet. |
| Buyer email and shipping address | D1, on the order | Written when an order is placed, which nothing can do yet: the order logic is built and has no route. Never written to a log. |
| Stripe keys and the webhook signing secret | Not stored yet | They will be plugin secrets, which Mallok encrypts. No code path reads them today. |
| Cart contents | D1, keyed by an unguessable 128-bit id | Variant ids and quantities only — **never prices**. A test asserts the table has no price column. |
| The cart cookie | `HttpOnly`, `SameSite=Lax`, `Secure` on HTTPS, scoped to `/_mallok/p/shop` | It identifies a cart and nothing else. It is not a session and grants nothing in the admin. |
| Prices, stock, variants | D1 | Changed only through the admin's variant form — which needs a signed-in administrator, or a token with `content:write` — or the plugin's own scheduled repricing. Every change of stock is a row in a ledger. |

## Design decisions that are security controls

These are deliberate and should not be "simplified" away:

- **Prices are never accepted from a client.** The cart stores quantities only;
  every amount is recomputed from the database when the cart is priced.
- **MOQ and stock are enforced on the server.** The form's `min` and `step` are
  a convenience. A direct POST is refused with the same rules, and a test posts
  one.
- **Stock cannot go negative.** The column carries `CHECK (stock >= 0)`, and a
  test proves that a decrement which would oversell rolls back the whole D1
  batch it is in.
- **Every input is validated with Zod** before it reaches the database.
- **Every SQL statement is parameterised.** Lists of ids travel as one JSON
  parameter rather than being spliced into the statement.
- **The redirect after a cart change goes only to a path on the same site.**
  Another origin, a protocol-relative `//host` and a backslash trick all fall
  back to the cart page, so the cart cannot be used as an open redirect.
- **A public page carries nothing of anyone's cart.** The form beside a size
  and the header's link to the cart are the same for every visitor, so the
  page stays in the shared cache. The cart cookie is sent only to the shop's
  own routes, and the cart page is served `private, no-store` and `noindex`.
- **A form posted from another site is refused** by Mallok before the shop
  sees it, so a page elsewhere cannot fill or empty a visitor's cart.
- **A page says whether a size can be had, never how many are left.** The
  count is read to decide the state and goes no further. Only the cart page,
  which is one visitor's own, says how many can be had — when it refuses a
  quantity that is more than that.
- **A cart cookie that is not a well-formed id is ignored**, and a fresh id is
  issued.
- **Cart size is bounded**: at most 100 lines and 10,000 units per line, so one
  cart cannot be grown without limit.
- **The cart's routes are rate limited** through Mallok's rate-limit bindings, each route with its own count per visitor, at the relaxed tier: a buyer changes a cart many times in ordinary use.
- **Logs never contain personal data.** The scheduled work logs counts and a
  reference date.
- **The theme runs three scripts in a visitor's browser, and says so.** Each
  is a file of the site's own, declared in `theme.json` with its size. One is
  loaded on the home page and the catalogue to filter a table that is
  already in the page; one on an engineering reference page that asks for
  it, to compute from numbers the visitor types; one on pages with prices in
  more than one currency, to show another currency's amounts, which are
  already in the page. None sends anything anywhere. The currency switch
  keeps one thing, the code of the currency chosen, in the browser's own
  storage — not in a cookie, which would be sent with every page — and works
  without it where storage is blocked. The cart needs no script: adding,
  changing and removing are plain forms. There is no inline
  script and no inline event handler. Tests fail if a template loads a
  script that is not declared, if a declared size is not the file's, or if
  any other page carries a script that is not structured data.
- **The theme loads nothing from another host.** Its fonts and images are
  files served by the site, so no visitor's address is passed to a third
  party by opening a page. The inquiry form is Mallok's: with Turnstile
  configured it loads Cloudflare's challenge script on the pages that carry
  the form.
- **A manual price is never overwritten.** The repricing statement re-checks it
  at write time, so a price set by hand between the read and the write still
  stands.

### Payment, built and not yet reachable

The order and payment logic is in the repository with its tests, and no route
calls it yet. These controls are in that code now, so that they are not left
to be remembered when the routes are written:

- **A payment is believed only with Stripe's signature** over the bytes as
  received, compared in constant time, and only within five minutes of the
  time Stripe signed it. Only the `v1` scheme is read. With no signing secret
  configured, everything is refused.
- **No amount comes from a client.** An order's lines are priced by the
  server, and the call that opens a Checkout session takes a single amount,
  the order's total, rather than line items a client could have shaped.
- **Stock is taken when a payment is confirmed, never before.** Taking it when
  an order is placed would let scripted, unpaid orders empty the catalogue.
- **A payment takes stock once**, whether Stripe delivers the event twice,
  sends two events for one payment, or delivers twice at the same moment.
  Every write is conditional on the order's status, and tests run the
  deliveries in parallel.
- **A payment is all or nothing.** The event, the stock, the ledger, what is
  owed afterwards and the order's status are one D1 batch. An order whose
  stock has gone is marked `oversold` with nothing taken, for a person to
  refund.
- **Money taken is never left without a trace.** A payment for an order that
  cannot take it — a cancelled one, or one another payment has settled — is
  recorded with the payment to refund, and the order and the stock are left
  alone.
- **A webhook fails only for what a retry could fix.** Anything else answered
  with an error would be redelivered for three days. A payment naming an
  order this shop does not have is answered and not acted on: every shop on a
  Stripe account sees every payment of that account.
- **Money is a whole number at the database too.** The order tables check the
  storage type of every amount, so a fraction of a minor unit cannot be
  stored even by code that forgot to round.
- **A Stripe error never carries what was sent.** It is described by Stripe's
  own identifiers and the HTTP status. The free-text message is dropped:
  nothing rules out its repeating a value that was sent, such as an email
  address.
- **An order's status moves only as the state machine allows**, and only if
  the order is still where it was read. An oversold order cannot ship.
- **Order lines are snapshots.** A later change to a product cannot alter what
  a past order says was bought, or for how much.
- **Emails escape everything a person typed** — product names, SKUs, tracking
  numbers — before it becomes markup in a buyer's inbox.
- **A failure reason never carries personal data.** It names the order by id.

## Known residual risks

Stated plainly rather than left for an auditor to find:

- **The rate limit is coarse.** Cloudflare's binding counts per location and
  is eventually consistent, by its own description. It slows scripted abuse;
  it is not an exact quota. A determined client can still create carts, and
  each costs D1 writes against the account's daily allowance; the cart page
  costs D1 reads on every request, since it is never cached.
- **The exchange-rate feed is a third-party dependency.** If the ECB serves
  wrong data, automatic prices recompute from it. The drift threshold and the
  buffer limit the blast radius, and a failed fetch keeps the previous
  snapshot, but no sanity band on the rate itself is enforced yet.
- **A cached page can show a price that has since changed.** A page carries
  the price it was rendered with, and is purged when a variant is saved in
  the admin or a repricing run moves a price. Where the purge does not reach
  — a site without a purge token, a purge Cloudflare refuses, or the defect
  Mallok has recorded in which a purge is reported and does not happen — the
  page keeps the old price until its cache entry expires, an hour by default.
  The cart never does: it prices every line from the database on every
  request, so what a buyer is shown before ordering is the price they pay.
  Whether purges evict on a deployed site has not been verified here.
- **Setting stock in the admin overwrites it.** The form sets a figure. A
  payment that lands between opening the form and saving it is lost from the
  figure, though not from the ledger, which records the difference from the
  stock as it was when the write landed.
- **Sample content and sample variants are public test data.** Do not load
  `seed/shop-sample.sql` into a production database. The sample catalogue
  describes a supplier that does not exist: its certifications, test figures
  and compliance statements are illustrative, and a real site must replace
  them with its own before it is published.
- **Nobody is told about a payment that has to be refunded.** An oversold
  order, and a payment for an order that was cancelled while its buyer was
  still on Stripe's page, are both recorded with a row in the outbox — and
  nothing reads the outbox yet. Until something does, a person finds them
  only by looking. Cancelling an order should also expire its Checkout
  session, so that the second case cannot arise; that is not built either.
- **The amount Stripe reports is not compared with the order's total.** The
  session is opened for the order's total by the server, so they agree unless
  something on the Stripe side changes what the buyer pays. Not yet decided;
  see the design's §14.
- **Orders that are never paid stay in the database as `pending`**, with the
  buyer's email and address, until something removes them. Nothing does yet.
- **An order that costs nothing cannot be completed.** Stripe is never asked
  to charge zero, and nothing confirms a free order without it yet.

## Dependency posture

Runtime dependencies are deliberately minimal: `mallok` and `zod`. The ECB feed
is called over plain `fetch`. Every dependency is attack surface that a
self-hosted shop inherits.

Before adding one, ask whether the platform or Mallok already provides it.
