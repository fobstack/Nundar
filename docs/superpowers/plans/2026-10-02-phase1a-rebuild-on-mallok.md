# Phase 1A: rebuilding Nundar on Mallok

> Date: 2026-10-02
> Design: `docs/superpowers/specs/2026-09-30-nundar-on-mallok-design.md`
> Builds on: `mallok@0.1.0-rc.7`

## Goal

Replace the standalone Next.js application with a Mallok site that carries a shop plugin, a commerce theme and sample content — everything that can be built before Mallok gains the extension points the rest of the shop needs.

Phase 1B, which needs those extension points, follows once Mallok ships them.

## What was built

**The site skeleton**
- The project `mallok create --no-deploy` generates, depending on Mallok at an exact version.
- The Next.js application, OpenNext, Drizzle and their configuration are removed; the previous implementation is at the tag `nextjs-final`.

**The shop plugin (`src/plugins/shop/`)**
- Tables for variants, prices, exchange rates, carts and cron state.
- Money, the pricing rules, ECB rate parsing, chunked repricing, cart pricing and the order state machine, ported from the previous implementation and reviewed on the way.
- `POST /_mallok/p/shop/cart`: add, set and remove through a plain form POST, with MOQ and stock enforced server-side.
- A scheduled hook that does one small piece of work per minute: a repricing chunk, a rate fetch, or clearing expired carts.
- A read-only admin panel listing variants.

**The commerce theme (`src/theme/`)**
- Kinds: `page`, `article`, `product`, `application`, `collection`.
- Layouts for the home page, lists, products, application notes, collections, pages and articles.
- Interface strings in English, German, French and Spanish.
- No client JavaScript.

**Sample content**
- One product, one application note, one collection and a contact page, each in four languages with its own slug.
- `seed/shop-sample.sql` with two variants and their base prices.

## How it was verified

| Check | What it covers |
|---|---|
| `npm run lint`, `npm run typecheck` | Biome and TypeScript, strict |
| `npm run test:project` | Site configuration; every reference in the sample content resolves in its own language; every multilingual bundle pins its translation group; the seed names a product that exists |
| `npm run test:shop` | The plugin and the theme inside workerd, against the site's own Worker, brought up through Mallok's HTTP API |
| `npm run build` | `mallok prepare` and a deploy dry run |
| `npm run smoke`, `npm run smoke:shop` | A real local Worker: settings applied, content published with the Mallok CLI, the seed loaded, pages in two languages, the cart |
| `mallok build` | A static build of the sample content: 36 pages in four languages, no broken reference |

Guards were checked by breaking them and watching the test fail: the server-side MOQ check, the same-site redirect check, the protection of manual prices, the stock constraint, `page.head` in the base layout, a reference in the sample content, and a missing identity file.

## What implementation uncovered

**About D1**
- A `CHECK` failure inside a batch rolls the whole batch back, including statements that ran before it. A conditional `UPDATE` that matches no row is not a failure, and the batch commits around it. The payment write in phase 2 must rely on the constraint.
- A list of rows can be written in one statement by passing it as a single JSON parameter and expanding it with `json_each`. Repricing forty variants in two currencies costs two round trips.

**About Mallok 0.1.0-rc.7**
- Only `reference` fields are resolved for a template; `reference[]` is not. A product therefore names one collection.
- The Worker's home page receives recent articles only, although the theme format documents `recent.<kind>` and the static build supplies every kind.
- The CLI publishes each language of a bundle without an identity file as a separate translation group, which removes its hreflang. Every multilingual bundle here carries a `mallok.json`.
- `mallok publish . --with-settings` cannot be run from the repository root: it scans `node_modules`, and it resolves kinds before applying the settings. `scripts/apply-settings.mjs` applies `site.json` instead.
- The site template has no type declarations for text-module imports and no `MALLOK_SETUP_KEY` in `.dev.vars.example`; both are added here.

**About the toolchain**
- Mallok supports npm only, so pnpm is gone.
- npm 10.9.7 fails while adding some packages to this dependency tree. The lockfile was produced with npm 11; `npm ci` works with either.

**About the previous code**
- Its repricing loop read and wrote each price in its own query, which would have passed D1's per-invocation query limit on a real catalogue.
- Its state machine returned "not allowed" for an unknown status. The first port threw instead; the test ported with it caught that.

## What waits for phase 1B

Each item needs an extension point listed in the design's §7.

- Variants, prices and availability on product and list pages, and `Offer` structured data.
- Purging a product's pages when its price or availability state changes.
- The cart page, rendered through the theme.
- Editing variants, prices and stock in the admin.
- Keeping variants in step when a product is saved or deleted.
- The currency switch.
- Submitting a cart as one inquiry.
- Measuring product-page CPU and D1 round trips on a real Free account.
