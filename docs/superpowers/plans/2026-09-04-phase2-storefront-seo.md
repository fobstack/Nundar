# Phase 2: storefront browsing and SEO foundations — implementation plan

> **How this was executed**: by a single session holding the full context, which is why it is organised by task — each one giving an interface contract and the test points it must cover — rather than restating code step by step. Execution still followed TDD strictly: write a failing test, confirm it fails, implement, confirm it passes, commit.

**Goal:** make every product a complete, fully optimised static page, and promote use cases into landing pages on demand, forming the long-tail matrix.

**Architecture:** product pages, use-case pages and the listing all go through `generateStaticParams` with ISR. SEO metadata (hreflang, canonical, JSON-LD) is produced by one central SEO layer rather than reimplemented per page. Stock and prices are patched into the static page after hydration through `/api/inventory`.

**Tech stack:** as phase 1, with no new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-03-nundar-design.md`, section 5

## Global constraints

Everything from phase 1, plus:

- **The language is decided solely by the URL path prefix.** No IP-based redirects, no IP-based content rewriting
- **Every page must emit the complete hreflang set** (four languages plus x-default). Missing it makes Google treat the language versions as duplicate content
- **A use-case landing page's canonical points at itself**, never at the product page — pointing it there forfeits that page's ranking
- **Use cases with `has_own_page = 0` get no page and do not enter the sitemap**
- **Stock numbers in a static page are assumed stale** and are replaced by client-side data

---

## Task 1: site configuration and the SEO layer

**Files:** `src/config/site.ts`, `src/lib/seo.ts`, `tests/lib/seo.test.ts`

**Produces:**
- `SITE: { url: string; name: string }` (`url` from `NEXT_PUBLIC_SITE_URL`, defaulting to `http://localhost:3000`)
- `absoluteUrl(path: string): string`
- `buildAlternates(pathByLocale: (locale: Locale) => string): { canonical: string; languages: Record<string, string> }`
- `localePath(locale: Locale, ...segments: string[]): string`

**Test points:**
1. `localePath("de", "products", "x")` gives `/de/products/x`
2. `buildAlternates` emits all four languages
3. `buildAlternates` emits `x-default`, pointing at the default language
4. The canonical is an absolute URL
5. Joining paths never produces a double slash

## Task 2: the product detail query

**Files:** `src/lib/queries/products.ts` (extended), `tests/lib/queries/product-detail.test.ts`

**Produces:**
- `getProductDetail(db, slug, locale, currency): Promise<ProductDetail | null>`
  returning the product's base fields, its translation in that language, `features[]`, `useCases[]` (with `hasOwnPage`), and `variants[]` (with `moq`, lead time, and the price in that currency alongside the currency actually used)
- `listProductSlugs(db): Promise<string[]>`, for `generateStaticParams`
- `listUseCasePages(db): Promise<{ slug: string; locale: Locale; useCaseSlug: string }[]>`, restricted to `has_own_page = 1`

**Test points:**
1. An unknown slug returns null
2. An archived product returns null
3. The name and description come back in the requested locale
4. Features and use cases are ordered by `sort_order`
5. Variants carry the MOQ and the lead time range
6. Prices come in the requested currency, falling back to the base currency and reporting that honestly
7. `listUseCasePages` returns only rows with `has_own_page = 1`

## Task 3: the product detail page

**Files:** `src/app/[locale]/products/[slug]/page.tsx`, `tests/app/product-page.test.ts`

**Block order** — the same for reading and for SEO: name, summary, price with MOQ and lead time, description, features, use cases (with internal links for those that have their own page)

**Produces:** `generateStaticParams` (four languages × every slug) and `generateMetadata` (title and description from the translation table, alternates included)

**Test points:** covered by Task 4's JSON-LD tests and by the build output assertions in the acceptance criteria

## Task 4: structured data (JSON-LD)

**Files:** `src/lib/seo/jsonld.ts`, `tests/lib/jsonld.test.ts`

**Produces:**
- `productJsonLd(input): object` — `Product` + `Offer` (`price`, `priceCurrency`, `availability`)
- `breadcrumbJsonLd(items): object`
- `useCaseJsonLd(input): object` — `Article` with its associated `Product`

**Test points:**
1. Prices are decimal strings in major units (`"99.00"`), not minor-unit integers
2. `priceCurrency` matches the currency actually used
3. Zero stock yields `OutOfStock`
4. `offers` covers every SKU
5. Breadcrumb positions start at 1 and increment
6. An MOQ emits `eligibleQuantity`; a lead time emits `deliveryLeadTime`

## Task 5: the use-case landing page

**Files:** `src/app/[locale]/products/[slug]/[useCaseSlug]/page.tsx`

**Produces:** pages only for `has_own_page = 1`; a self-referencing canonical; breadcrumbs back to the product page; and footer links back to the product and to the product's other use-case pages.

**Test point:** a slug with `has_own_page = 0` returns 404 — not generated at build time, and `notFound` at runtime

## Task 6: the product list page

**Files:** `src/app/[locale]/products/page.tsx`

Reuses `listActiveProducts` and emits `CollectionPage` + `ItemList` JSON-LD.

## Task 7: sitemap and robots

**Files:** `src/app/sitemap.ts`, `src/app/robots.ts`, `tests/app/sitemap.test.ts`

**Produces:** the home page, the listing, the product pages and the `has_own_page` use-case pages in every language, each with `lastModified`. robots blocks `/cart`, `/checkout`, `/account`, `/admin` and `/api`.

**Test points:**
1. Each product appears four times, once per language
2. Use cases with `has_own_page = 0` do not appear
3. Archived products do not appear
4. Every entry carries its alternates language map
5. The robots disallow list is complete

## Task 8: patching stock on the client

**Files:** `src/app/api/inventory/route.ts`, `src/components/LiveStock.tsx`, `tests/app/inventory-api.test.ts`

**Contract:** `GET /api/inventory?variants=a,b` returns `{ items: [{ variantId, stock, priceMinor, currency }] }`

**Test points:**
1. Returns live stock for the requested variants
2. An unknown variantId is ignored rather than raising an error
3. A missing parameter returns 400
4. More than 50 variants returns 400, against abuse
5. The response carries `Cache-Control: no-store`

## Acceptance criteria

- `pnpm test` green; `pnpm typecheck` and `pnpm lint` pass
- `pnpm build` produces 4 languages × (home + listing + product page) plus 4 languages × the use-case landing pages
- Product page HTML carries the complete hreflang set, a self-referencing canonical, and `Product` JSON-LD
- `/sitemap.xml` is reachable and contains no `has_own_page = 0` use-case pages

---

## Execution record, 2026-09-04

All eight tasks completed and verified.

**Pages added**: 4 languages × (home + listing + product page + use-case landing page) = 16 static pages, plus `/sitemap.xml`, `/robots.txt` and `/api/inventory`.

**Two real defects found and fixed while implementing:**

1. **hreflang pointing at 404s** (severe). Use-case landing page slugs are localised per language, but the first version built hreflang from the English slug for every language, so the German, French and Spanish hreflang all pointed at pages that do not exist. The root cause was that the per-language rows of `product_use_cases` had nothing identifying them as versions of the same thing. Fixed by adding the `group_key` column (see spec 4.2.1) and a `getUseCaseAlternates` query that resolves each language's real slug; a language missing its translation is omitted from hreflang rather than filled in with another language's slug.

2. **D1 concurrency failure during the build.** With `generateStaticParams` reading the local D1, several Next build workers hitting the same miniflare SQLite file concurrently produced `D1_ERROR: internal error`. Fixed by setting `experimental.cpus = 1` and `workerThreads = false` in `next.config.ts`, serialising the build.

**Other divergences:**

| Divergence | Why |
|---|---|
| Migrations merged into a single `0000` rather than appending `0001` | SQLite cannot add a NOT NULL column without a default to an existing table, and the project had not been deployed anywhere yet, so merging was safe |
| `useCaseJsonLd` renamed to `buildUseCaseJsonLd` | ESLint's `react-hooks/rules-of-hooks` mistook the `use` prefix for a React hook |
| The root path redirect landed early, outside the phase 2 plan | Already covered in phase 1 |

**Verification**: `pnpm test` green across 110 cases in 15 test files; `pnpm typecheck`, `pnpm lint` and `pnpm build` all pass.

Checked by hand against the dev server:
- `/sitemap.xml` lists 16 entries, excludes `has_own_page = 0` use cases, and gives each use-case page its own localised slug
- `/robots.txt` has the complete disallow list: api, admin, cart, checkout, account, and URLs with query parameters
- `/api/inventory?variants=...&currency=EUR` returns live stock and reports the currency actually fallen back to; a missing parameter returns 400
- A use-case URL that was never promoted returns 404
- Product page HTML carries hreflang in four languages plus x-default, a self-referencing canonical, and Product / Offer / BreadcrumbList JSON-LD including the MOQ's `eligibleQuantity` and the lead time's `deliveryLeadTime`
