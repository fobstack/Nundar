# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## What this repository is

Nundar is a single-tenant, self-deployed commerce engine for cross-border sellers: Next.js 16 (App Router) compiled for Cloudflare Workers by `@opennextjs/cloudflare`, using D1 (through Drizzle), R2, KV, a Cron trigger and the `send_email` binding. Its differentiator is long-tail SEO: every product carries per-language features and use cases, and a use case can be promoted (`has_own_page`) to its own landing page with a localised slug.

`docs/superpowers/specs/2026-09-03-nundar-design.md` is the source of truth for *why* things are built the way they are. Its §13 records where the implementation deliberately diverged (Stripe hosted Checkout instead of Elements, PBKDF2 instead of Argon2id, no pre-generated image variants, the theme system). The phase plans in `docs/superpowers/plans/` record what each phase uncovered. A change that contradicts a recorded decision updates the spec in the same PR — the PR template asks.

## Commands

```bash
pnpm install
pnpm setup                        # copy .dev.vars from the example, generate migrations, migrate + seed the local D1
pnpm dev                          # http://localhost:3000/en (also /de, /fr, /es); admin at /admin
pnpm test                         # full suite, inside workerd
pnpm vitest run tests/lib/money.test.ts                      # one file
pnpm vitest run tests/lib/orders/state.test.ts -t "oversold" # tests matching a name
pnpm typecheck
pnpm lint
pnpm build                        # next build; reads the LOCAL D1 (see "Database access")
THEME=editorial pnpm build        # build with the second theme
pnpm preview                      # OpenNext build + local Workers preview
```

CI (`.github/workflows/ci.yml`) runs `pnpm setup` → `typecheck` → `lint` → `test` → `build`; all must pass.

- **Schema changes**: edit `src/db/schema/*.ts`, run `pnpm db:generate` (drizzle-kit only writes SQL into `drizzle/migrations/`), then `pnpm db:migrate:local`. Migrations are always applied with `wrangler d1 migrations apply`, never by drizzle-kit. The test database is built from the same migration files, so there is no separate test schema.
- **Bindings**: after changing `wrangler.jsonc`, run `pnpm cf-typegen`. `cloudflare-env.d.ts` is generated — never edit it by hand.
- **D1 commands**, local and remote, reference the binding `DB`, never the database name: a Deploy-button user's database is named after their own project, and wrangler resolves a name through `wrangler.jsonc` even with `--local`.
- **Admin accounts**: `pnpm admin:create you@example.com [--remote]` reads the password from stdin and refuses it as an argument. A deployment with no administrators exposes first-run owner setup at `/admin/setup` (`src/lib/admin/setup.ts`).
- **Deploy**: `pnpm deploy` = migrate local D1 → `opennextjs-cloudflare build` → migrate remote D1 → deploy.
- `vitest-pool-workers` and `next dev` listen on `127.0.0.1`, and `tsx` (every `src/scripts` command, including `pnpm setup` and `pnpm admin:create`) opens an IPC socket; in a sandbox that forbids local listening they fail with `listen EPERM`.

## Architecture

### Runtime shape

- `src/worker.ts` is the Worker entry (`main` in `wrangler.jsonc`): OpenNext's generated fetch handler, a `scheduled` handler for the daily exchange-rate cron (06:00 UTC), and re-exports of OpenNext's three Durable Object classes. It imports the build artefact `.open-next/worker.js`, so it is excluded from `tsc`; `types/open-next-worker.d.ts` lets `pnpm typecheck` pass on a fresh clone. Keep it wiring only.
- ISR on Cloudflare is configured in `open-next.config.ts`: R2 incremental cache (`NEXT_INC_CACHE_R2_BUCKET`) behind a regional cache, a DO queue, a sharded DO tag cache, and cache purge. The Durable Objects exist only for this.
- `src/app` has three areas: `[locale]/…` (storefront: home, product list, product, use-case landing page, cart, checkout, order status), `admin/…` (`login` and `setup` outside the `(signed-in)` route group, everything else inside it sharing the sidebar layout), and `api/…` route handlers (cart, checkout, inventory, order status, Stripe webhook, image proxy, admin image upload). Plus `sitemap.ts`, `robots.ts` and `.well-known/security.txt`.

### Where logic lives: the testability split

Tests run inside the real workerd runtime via `@cloudflare/vitest-pool-workers`, against a stub entry (`tests/worker-entry.ts`), and never go through Next routes — `next/headers`, `next/navigation` and `next/link` cannot load there. Therefore:

- Business logic lives in `src/lib/**` as functions that take a `Db` (from `createDb(d1)`) or a binding (`KVNamespace`, R2 bucket) as a parameter. Tests call them with `createDb(env.DB)` from `cloudflare:test`; `tests/apply-migrations.ts` applies the migrations to each test worker's D1; `seedDatabase` from `src/scripts/seed.ts` supplies fixtures.
- Anything that touches Next APIs or Node APIs is a thin separate file over a pure one: `lib/auth/guard.ts` over `lib/auth/session.ts` / `admin.ts`, `lib/admin/locale.ts` over `lib/admin/i18n.ts`, `scripts/write-seed-sql.ts` (`node:fs`) over `scripts/build-seed-sql.ts`. Keep this split for new code; files in `src/app` should stay orchestration (auth guard, Zod parse, call `src/lib`, revalidate).

### Database access

- `getDb()` in dynamic routes, route handlers and server actions; `getDbAsync()` in statically generated pages (`generateStaticParams`, `generateMetadata`, SSG/ISR page bodies) — during static generation the Cloudflare context is only reachable asynchronously, and `getDb()` finds no bindings.
- **The build reads the local D1.** `generateStaticParams` runs on the build machine against miniflare's local database, so local migrations must be applied before `pnpm build` or it fails with `no such table`. Changing `database_id` in `wrangler.jsonc` points miniflare at a different, empty local database. The committed `wrangler.jsonc` carries `local-placeholder-replace-before-deploy` IDs.
- `next.config.ts` pins the build to one serial worker (`experimental.cpus: 1`, `workerThreads: false`) because concurrent build workers crash the local D1. The same file holds the security headers and CSP — edit it surgically, never rewrite it wholesale.

### Storefront rendering, SEO and themes

- Home, list, product and use-case pages are statically generated with ISR. Admin server actions must `revalidatePath` every affected storefront path in every locale plus `/sitemap.xml` (see `revalidateProduct` in `app/admin/(signed-in)/products/[slug]/actions.ts`), otherwise edits never appear in production.
- Stock and prices baked into static HTML go stale, so `components/LiveStock.tsx` fetches `/api/inventory` after hydration and patches DOM nodes marked `data-variant-id` / `data-price` / `data-stock`. The visitor's currency (a cookie) is also applied client-side.
- **Route layer vs theme** (`src/themes/contract.ts`): routes fetch data, emit metadata, hreflang and canonicals (`lib/seo.ts`) and JSON-LD (`lib/seo/jsonld.ts` via `components/JsonLd`), build every URL (`lib/site-urls.ts`), and supply interface strings (`lib/storefront/i18n.ts`). A theme (`src/themes/<name>/`: `tokens.css`, `layout/`, `views/`) only renders, and owns its own voice (hero copy, headings). Never move SEO, URL building or commerce vocabulary into a theme. The contract types are a public interface: changing one breaks every theme.
- Theme rules TypeScript cannot enforce: product views must emit the `data-*` attributes above; theme CSS is scoped under `.theme-<name>` and never `:root` (all registered themes share one bundle), with the Shell's root class matching. `tests/themes/contract.test.ts` checks this against the sources `vitest.config.mts` reads from disk. The theme is chosen at build time via `THEME` in `themes/registry.ts` (unknown names fall back to `default`); a new theme must be registered there.

### Languages

- Storefront locales (`en` default and `x-default`, `de`, `fr`, `es`) live in `src/config/locales.ts`. The URL prefix is the only source of language; never redirect or rewrite language or currency by IP — crawlers fetch mostly from US addresses and would see only one language. Currency defaults per locale and is otherwise the visitor's cookie choice.
- Translated content lives in translation tables or per-locale rows; never add `name_en` / `name_de` style columns. Features and use cases have one row per locale linked by `group_key`. Use-case slugs are localised, so hreflang resolves through `group_key`, and a language with no row is omitted rather than given another language's slug.
- The admin interface language (`en` authoritative, `zh`; `lib/admin/i18n.ts`, chosen by cookie) is a separate axis from storefront locales — don't share configuration between them. In both string catalogues the `en` entry defines the type, so every key must exist in every locale.
- Transactional email is rendered in the language stored on `orders.locale` (`lib/email/templates.ts`).

### Commerce invariants (security controls — see SECURITY.md; do not "simplify" them away)

- Money is always integer minor units (`*_minor`, `lib/money.ts`), never a float.
- The KV cart stores variant ids and quantities only. `priceCart` (`lib/cart/pricing.ts`) recomputes prices from D1 and re-validates availability, MOQ and stock at checkout; no request body carries an amount.
- Checkout (`api/checkout`) creates a `pending` order whose lines are snapshots, then a Stripe hosted Checkout session over plain `fetch` (`lib/stripe/client.ts`, no SDK).
- Only the Stripe webhook marks an order paid (`markOrderPaid` in `lib/orders/orders.ts`): verify the signature over the raw body, dedupe on `stripe_events`, decrement stock with `WHERE stock >= qty`, compensate manually on partial failure (there is no transaction spanning those statements), and mark the order `oversold` rather than let stock go negative. Return non-2xx on a genuine failure so Stripe redelivers, 200 for ignored or duplicate events; an email failure never changes the response.
- Order status changes only through the transitions in `lib/orders/state.ts`.
- MOQ is enforced on the product page, at add-to-cart, and server-side at checkout.
- Pricing: USD is the only hand-entered base price. EUR/GBP rows are `auto` (ECB rate × buffer, psychological rounding, recomputed only past a drift threshold) or `manual` (never overwritten). The cron path is `lib/pricing/cron.ts` → `ecb.ts` → `recalculate.ts`.
- Public APIs are rate-limited with KV fixed windows keyed on `cf-connecting-ip`, never `x-forwarded-for` (budgets in `lib/security/rate-limit.ts`). Every external input passes Zod. Logs never contain PII — log order ids, not emails or addresses.
- Admin auth: PBKDF2 via WebCrypto (`lib/auth/password.ts`; self-describing hash format with `needsRehash`), opaque session tokens in KV, roles `owner` / `staff` enforced by `requireAdmin` / `requireOwner`. Login is rate-limited and answers identically for an unknown account and a wrong password.
- Markdown is HTML-escaped before it is parsed (`lib/markdown.ts`).
- Security headers and the CSP are in `next.config.ts`; any new third-party origin (fonts, scripts, APIs) needs a CSP entry. R2 images are served through `api/images/[...key]` (private bucket, `products/` prefix, traversal guard); uploads are validated by magic bytes (`lib/media/images.ts`).
- Dependencies are deliberately few — Stripe and ECB over `fetch`, crypto via WebCrypto. Ask whether the platform already provides something before adding a package.

### Admin UI

The admin is built on shadcn/ui (`components.json` style `base-nova`, whose primitives come from `@base-ui/react`, not Radix), with components in `src/components/ui`. The storefront does not use it; its look belongs to the theme.

## Conventions

- Everything in the repository is English: code comments, docs, commit messages, and source UI strings (`en` is the authoritative locale for storefront and admin). `README.md` is authoritative; `README.zh-CN.md` is a derived translation, so change the English first.
- Comments explain *why*, often naming the defect that motivated the code. Match that density and keep comments accurate when the code changes.
- Conventional Commits, one concern per commit.
- `.dev.vars` (gitignored, created from `.dev.vars.example`) holds `THEME`, the Stripe keys and `MAIL_FROM_ADDRESS`. `NEXT_PUBLIC_SITE_URL` drives every canonical and hreflang (`src/config/site.ts`).
- The `cloudflare.bindings` block in `package.json` supplies the Deploy to Cloudflare form descriptions; keep it in sync when adding a binding or secret. The R2 media binding must not be named `IMAGES` (reserved by Cloudflare Images). `compatibility_date` must not exceed what the local workerd supports, or the test pool refuses to start.
