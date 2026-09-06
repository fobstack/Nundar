# Security Policy

## Reporting a vulnerability

**Do not open a public issue for a security problem.** Report it privately
through GitHub's [private vulnerability reporting][gh-private] on this
repository — that is the channel we monitor, and it keeps the report
confidential until a fix ships.

### Reporting a vulnerability in a deployed shop

If you found this in a running Nundar storefront rather than in this
repository, that deployment publishes its own contact at
`/.well-known/security.txt` ([RFC 9116][rfc9116]). Report it there — the
operator of that shop is not necessarily anyone here.

> Operators: set your address under **Settings -> Security contact** in the
> admin. Leaving it empty serves no `security.txt` at all, which is the right
> default: a file naming an address nobody reads spends a researcher's goodwill
> before they give up.
>
> Note that Cloudflare's Worker email binding only **sends**. To receive mail at
> that address you also need Email Routing configured for the domain in the
> Cloudflare dashboard.

Include: what you found, how to reproduce it, and what an attacker could achieve.
A working proof of concept helps but is not required.

You will get an acknowledgement within 3 working days and an assessment within
10. If the report is valid we will agree a disclosure date with you before
publishing.

[rfc9116]: https://www.rfc-editor.org/rfc/rfc9116
[gh-private]: https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability

## Supported versions

Nundar is a self-deployed template rather than a hosted service: you run your own
fork. Security fixes land on `main`. There are no backported release branches —
rebase your fork onto `main` to pick up fixes.

## What Nundar handles, and what it deliberately does not

Knowing where the trust boundaries are is the point of this section.

| Data | Where it lives | Notes |
|---|---|---|
| Card numbers, CVV | **Never touches Nundar** | Payment happens on Stripe's hosted checkout. The server never sees card data, so it is out of scope for PCI DSS SAQ-A purposes. |
| Admin passwords | D1, PBKDF2-SHA256 (210k iterations), per-user random salt | Never logged, never returned by an API. |
| Admin sessions | KV, opaque 256-bit random token | The cookie carries only the token; role and identity live server-side so they cannot be forged client-side. |
| Customer addresses, emails | D1, and a snapshot on the order | Excluded from all logs. |
| Stripe keys, webhook secret | `wrangler secret` / `.dev.vars` | Never in the repository. `.dev.vars` is gitignored. |
| Cart contents | KV, keyed by an unguessable random id in an HttpOnly cookie | Stores only variant ids and quantities — **never prices**, which are always recomputed server-side. |

## Design decisions that are security controls

These are deliberate and should not be "simplified" away:

- **Prices are never accepted from the client.** The cart stores quantities only;
  every total is recomputed from the database at checkout, and the Stripe amount
  comes from that computation.
- **Webhooks are signature-verified and idempotent.** Stripe signatures are
  checked with HMAC-SHA256 over the raw body with a timestamp window; event ids
  are deduplicated so a replayed delivery cannot decrement stock twice.
- **Stock decrements are conditional** (`WHERE stock >= qty`) and roll back on
  partial failure, so stock can never go negative.
- **Login is rate-limited** (5 attempts, 15-minute lockout) and returns an
  identical result for a wrong password and an unknown account, so the endpoint
  cannot be used to enumerate valid accounts.
- **Markdown is escaped before it is parsed.** The renderer escapes all HTML
  special characters first and then applies a restricted syntax subset, so the
  set of tags it can emit is fixed by the renderer rather than by its input.
  `javascript:` and `data:` link targets are dropped.
- **All external input is validated with Zod** before it reaches business logic.
- **Logs never contain PII.** Order failures log an order id, never an email or
  address.

- **Every public API is rate-limited** by the Cloudflare-set `cf-connecting-ip`
  (never `x-forwarded-for`, which any client can forge). Checkout is the
  tightest at 10 per 10 minutes because each call creates an order row and a
  Stripe session — unlimited, it is a way to inflate the database, exhaust the
  Stripe quota and generate real charges.
- **Security headers are set on every response**: `X-Frame-Options: DENY` (a
  storefront has no reason to be framed, and an overlay that looks like the real
  Add-to-cart button is exactly how clickjacking works), `nosniff`,
  `strict-origin-when-cross-origin` referrer policy (order numbers live in URLs
  and must not leak to third parties), a restrictive `Permissions-Policy`, HSTS,
  and a CSP whose `script-src` excludes `unsafe-inline`.
- **Admin passwords are never accepted as command-line arguments.**
  `pnpm admin:create` reads from stdin and refuses a positional password:
  arguments are visible in `ps` output to every user on the machine and are
  written to shell history.

## Known residual risks

Stated plainly rather than left for an auditor to find:

- **Order numbers are enumerable in principle.** The format is
  `SC-YYMMDD-XXXXXX` with six hex characters. `/api/orders/status` returns only
  the order number and status — no addresses, amounts or emails — and is rate
  limited, but a determined attacker could learn that a given order exists. The
  alternative, requiring login to see order status, would break guest checkout,
  which is the majority of cross-border trade orders.
- **`style-src` allows `unsafe-inline`.** The theme system uses inline styles
  deliberately so themes can be restyled without touching stylesheets. This
  weakens CSS-injection defence but not script injection.
- **Currency preference on static pages is applied client-side**, so the first
  paint shows the locale default. This is a correctness-visible trade of static
  generation, not a security issue, but it is worth knowing when reading the
  price-rendering code.
- **The exchange-rate feed is a third-party dependency.** If ECB serves wrong
  data, prices recompute from it. The 2% drift threshold and the buffer limit
  the blast radius, and a fetch failure keeps the previous snapshot, but no
  sanity band on the rate itself is enforced yet.

## Dependency posture

Runtime dependencies are deliberately minimal — Next.js, React, Drizzle and Zod.
Stripe and the exchange-rate feed are called over plain `fetch` rather than
through vendor SDKs, and password hashing and webhook signature verification use
WebCrypto rather than a crypto library. Every dependency is attack surface that
a self-hosted commerce system inherits.

Before adding one, ask whether the platform already provides it.
