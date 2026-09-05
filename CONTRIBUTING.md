# Contributing to Kontor

Thanks for taking the time to contribute.

## Getting set up

```bash
pnpm install
pnpm setup      # generates migrations, creates the local DB, loads sample data
pnpm dev
```

No Cloudflare account is needed for local development — D1, R2 and KV are all
simulated locally by miniflare.

## Before you open a pull request

```bash
pnpm test        # runs in the real Workers runtime, not a Node mock
pnpm typecheck
pnpm lint
```

All three must pass. New logic needs matching tests.

## Design decisions live in `docs/`

Before changing anything structural, read
`docs/superpowers/specs/2026-09-03-kontor-design.md`. It records not just what
the system does but **why** — the reasoning behind decisions like storing money
as integer minor units, decrementing stock only after payment, and never
redirecting by IP.

If your change contradicts a decision recorded there, update the spec in the
same pull request and explain the new reasoning.

## Conventions worth knowing

| Area | Rule |
|---|---|
| Money | Always integer minor units (`amount_minor`). Never floats. |
| Language | Determined solely by the URL prefix. Never redirect or rewrite by IP — it stops crawlers from seeing other languages. |
| Translations | Split into `*_translations` tables. Never add `name_en` / `name_de` style columns. |
| Content blocks | Features and use cases match across languages via `group_key`. |
| Order status | Only the transitions in `src/lib/orders/state.ts` are legal. |
| Stock | Decremented after payment is confirmed, never at add-to-cart or order creation. |
| Webhooks | Must be idempotent. Stripe redelivers. |
| Secrets | Never in the repo. Use `wrangler secret` or `.dev.vars`. |
| Remote D1 commands | Reference the **binding** (`DB`), never the database name. Someone deploying via the button gets a database named after their own project, and a hardcoded name breaks their migrations. |
| Prices | Never accepted from the client. Recomputed server-side at checkout, always. |
| Dependencies | Ask whether the platform already provides it. Every dependency is inherited attack surface. |

## Contributor licensing — read this before your first PR

Kontor is dual-licensed `MIT OR Apache-2.0`, and contributions require a signed
[ICLA](CLA.md).

**Why a CLA rather than just a DCO.** A DCO certifies you had the right to
submit your code, but you keep the copyright. That means the project cannot be
relicensed, combined into a larger work, or transferred without contacting every
past contributor individually — which is effectively impossible once a project
has more than a handful. The CLA grants a sublicensable license so those options
stay open.

We are being upfront that this is a real cost: CLAs deter some contributors. It
is a deliberate trade.

**Signing takes one line.** In the same pull request as your first contribution,
add yourself to `CONTRIBUTORS.md`:

```
Full Name <email@example.com> — signed Kontor ICLA, YYYY-MM-DD
```

Contributing on behalf of an employer? Your employer needs a Corporate CLA
first — open an issue titled "CCLA request".

## Security

Never open a public issue for a security problem. See [SECURITY.md](SECURITY.md)
for private reporting, the trust boundaries, and the design decisions that are
security controls rather than style choices.

## Commit messages

Conventional Commits, one concern per commit:

```
feat: add bulk price import to the admin
fix: stop the cart from pricing archived products
docs: explain the group_key mechanism
```

## Adding a language

1. Add the locale to `src/config/locales.ts` and map its default currency.
2. Translate content through the admin — the Translations workbench shows what
   is missing.

No schema change is needed. That is the point of the translation tables.
