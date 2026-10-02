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
| Card numbers, CVV | **Nowhere in Nundar** | Payment is not implemented yet. The design sends buyers to Stripe's hosted checkout, so card data will never reach this code. |
| Cart contents | D1, keyed by an unguessable 128-bit id | Variant ids and quantities only — **never prices**. A test asserts the table has no price column. |
| The cart cookie | `HttpOnly`, `SameSite=Lax`, `Secure` on HTTPS, scoped to `/_mallok/p/shop` | It identifies a cart and nothing else. It is not a session and grants nothing in the admin. |
| Prices, stock, variants | D1 | Changed only through the admin or the plugin's own scheduled repricing. |

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
  back to the home page, so the cart cannot be used as an open redirect.
- **A cart cookie that is not a well-formed id is ignored**, and a fresh id is
  issued.
- **Cart size is bounded**: at most 100 lines and 10,000 units per line, so one
  cart cannot be grown without limit.
- **The cart route is rate limited** through Mallok's rate-limit binding.
- **Logs never contain personal data.** The scheduled work logs counts and a
  reference date.
- **The theme ships no client JavaScript** and no inline event handlers. A test
  fails if a rendered page contains a script that is not structured data.
- **A manual price is never overwritten.** The repricing statement re-checks it
  at write time, so a price set by hand between the read and the write still
  stands.

## Known residual risks

Stated plainly rather than left for an auditor to find:

- **The rate limit is coarse.** Mallok's binding counts per Cloudflare location,
  is eventually consistent, and gives every route of a plugin one shared budget
  per address. It slows scripted abuse; it is not an exact quota. A determined
  client can still create carts, and each costs D1 writes against the
  account's daily allowance.
- **The exchange-rate feed is a third-party dependency.** If the ECB serves
  wrong data, automatic prices recompute from it. The drift threshold and the
  buffer limit the blast radius, and a failed fetch keeps the previous
  snapshot, but no sanity band on the rate itself is enforced yet.
- **Prices are not shown on cached pages yet**, so nothing can drift between a
  page and the cart today. When they are, the page and its structured data
  will be purged whenever a price or an availability state changes; until that
  exists, do not show prices by another route.
- **Sample content and sample variants are public test data.** Do not load
  `seed/shop-sample.sql` into a production database.

## Dependency posture

Runtime dependencies are deliberately minimal: `mallok` and `zod`. The ECB feed
is called over plain `fetch`. Every dependency is attack surface that a
self-hosted shop inherits.

Before adding one, ask whether the platform or Mallok already provides it.
