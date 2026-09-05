# Security Policy

## Reporting a vulnerability

**Do not open a public issue for a security problem.** Report it privately
through GitHub's [private vulnerability reporting][gh-private] on this
repository, or email [YOUR SECURITY CONTACT].

Include: what you found, how to reproduce it, and what an attacker could achieve.
A working proof of concept helps but is not required.

You will get an acknowledgement within 3 working days and an assessment within
10. If the report is valid we will agree a disclosure date with you before
publishing.

[gh-private]: https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability

## Supported versions

shopcf is a self-deployed template rather than a hosted service: you run your own
fork. Security fixes land on `main`. There are no backported release branches —
rebase your fork onto `main` to pick up fixes.

## What shopcf handles, and what it deliberately does not

Knowing where the trust boundaries are is the point of this section.

| Data | Where it lives | Notes |
|---|---|---|
| Card numbers, CVV | **Never touches shopcf** | Payment happens on Stripe's hosted checkout. The server never sees card data, so it is out of scope for PCI DSS SAQ-A purposes. |
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

## Dependency posture

Runtime dependencies are deliberately minimal — Next.js, React, Drizzle and Zod.
Stripe and the exchange-rate feed are called over plain `fetch` rather than
through vendor SDKs, and password hashing and webhook signature verification use
WebCrypto rather than a crypto library. Every dependency is attack surface that
a self-hosted commerce system inherits.

Before adding one, ask whether the platform already provides it.
