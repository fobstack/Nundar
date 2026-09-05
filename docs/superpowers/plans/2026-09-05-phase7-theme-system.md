# Phase 7: the theme system — implementation record

> A record written after the fact. This phase was not in the original six-phase
> plan; it was added once the storefront had a real design, and extended once a
> second theme proved the first contract was incomplete.

**Spec:** recorded in the divergence section of
`docs/superpowers/specs/2026-09-03-nundar-design.md`

**Commits:** `7964337`, `9e2cd51`, `2b479ab`

---

## Why a theme system at all

The requirement was stated plainly: the shop should have a template directory,
the way Astro does, so the look can be changed later without rebuilding the
shop.

The risk in granting that is equally plain. This project's entire value is its
SEO surface — localised use-case slugs, hreflang that resolves per language,
self-referencing canonicals, structured data. If a theme can touch any of that,
then every theme author is one mistake away from destroying the thing the
software exists to do.

## The dividing line

**The route layer fetches data, produces SEO metadata, computes paths, and
supplies interface strings. A theme decides only how things look.**

A theme never assembles a URL, and never translates an interface string. Both
arrive as props. The consequence is that a broken theme can make the site ugly
and cannot make it unindexable.

This was tested immediately: during the initial theme refactor the `ItemList`
JSON-LD on the product listing was lost, because it had been sitting in the
component that became a view. Catching it confirmed the rule rather than
weakening it — the fix was to move the structured data back into the route,
where it now cannot be reached from a theme at all.

## Build-time, not runtime

`THEME=<name>` selects a theme and the site is rebuilt.

Runtime switching was rejected. In a single-tenant self-hosted shop the theme is
chosen once and rarely changed, whereas switching at runtime would mean bundling
every theme into the Worker and invalidating the static page cache on every
switch. That is a large, permanent cost for flexibility nobody in this scenario
needs.

An unknown theme name falls back to the default with a warning. A whole site
blank in production because a name was misspelled is far worse than the same
site rendered with different styling.

`resolveThemeName` is kept out of the registry because the registry has to
import each theme's React components, which cannot be loaded in the bare Workers
test runtime. Separating the pure logic is what makes it testable — the same
split that later forced the CSS scoping guard to read files through a binding
instead of importing them.

## What the second theme exposed

The contract had exactly one implementation for its whole life. Writing a second
one turned up three defects, each of which had been invisible and none of which
TypeScript could have caught.

### 1. Theme stylesheets collided

Tokens were declared on `:root`, and every rule hung off a shared `.theme-root`
class.

The registry imports every registered theme **statically**, so as soon as two
themes are registered both stylesheets land in the same bundle regardless of
which one `THEME` selects. Both would have defined the same `:root` variables and
the same `.theme-root` rules, and the last stylesheet loaded would have won —
silently, with `THEME` meaning nothing at all.

Verified after the fix: one built CSS chunk contains `.theme-default` 19 times
and `.theme-editorial` 20 times, and each theme's rules resolve only under its
own scope.

Each theme is now scoped to `.theme-<name>`. Two tests enforce it: one fails on
any selector that escapes the theme's own class or reaches `:root`, another
fails if a theme's `Shell` applies a class that is not its own — the exact
mistake someone makes when copying a theme and renaming the directory.

The stylesheets are read on the Node side in `vitest.config.mts` and passed
through a binding, because the Workers test runtime has no filesystem and Vite's
`?raw` does not survive the CSS pipeline. They are discovered by scanning the
themes directory, so a theme added later is covered automatically rather than
only once somebody remembers to register it.

### 2. Interface strings were trapped inside themes

Every view carried its own four-language copy deck. That made each theme author
a translator into four languages, and the translations had already rotted:

- The breadcrumb read `locale === "de" ? "Produkte" : "Products"`, so French and
  Spanish visitors saw an English breadcrumb on the two most SEO-critical pages
- The header tagline was English in all four languages

Commerce vocabulary now lives in `src/lib/storefront/i18n.ts`, English
authoritative, with the same `Widen<>` type enforcement the admin dictionary
uses — a missing translation fails to compile.

**A theme still owns its voice.** The rule, now stated in the contract: if
getting it wrong is a bug, it is shared; if getting it different is a design
choice, it belongs to the theme. Under that split the second theme needed six
voice strings per language instead of about thirty.

### 3. The route layer emitted an English breadcrumb in every language

The most serious of the three, because it was in the layer that is supposed to
own SEO:

```ts
{ name: "Products", url: absoluteUrl(localePath(locale, "products")) }
```

Every language version's `BreadcrumbList` structured data told Google the
breadcrumb read "Products". The visible text was wrong for French and Spanish;
the structured data was wrong for all four.

Both now read the same catalogue, so the structured data and the visible
breadcrumb cannot disagree.

## The part TypeScript cannot enforce

`LiveStock` replaces the stock and price baked into a static page after
hydration, and it finds what to replace through DOM attributes rather than
props:

```tsx
<div data-variant-id={variant.id}>
  <span data-price>…</span>
  <span data-stock>…</span>
</div>
```

A theme that omits them compiles, renders, and looks correct. The page simply
keeps showing whatever stock was true when it was generated — the exact failure
the mechanism exists to prevent. This was undocumented until the second theme
had to reproduce it; it is now stated in the contract.

A stronger fix would pass the live values as props and let the theme render them
normally. That is a larger change to `LiveStock` and is not done.

## The two themes

They are deliberately opposites, because a second theme that merely recolours
the first proves nothing about the contract.

| | default | editorial |
|---|---|---|
| Type | IBM Plex grotesque | serif display, sans for data |
| Ground | cool white | warm paper |
| Depth | hairline borders | soft shadows |
| Corners | 2px | 14px |
| Product list | comparison rows | cards |
| Use-case page | article plus product rail | single centred column |
| Home page leads with | the catalogue | application notes |

The last row is the one that matters. It is a structural difference, not a
visual one, and the contract permitted it without change — which is the closest
thing to evidence that the contract is real.

Both were verified in a browser across `en`, `de` and `fr`.

## Still open

- A theme cannot supply its own routes or page types. Adding a page type means
  changing the contract, which is a breaking change for every theme.
- `LiveStock`'s DOM coupling is documented rather than removed.
- No theme is distributed separately from the repository; "install a theme"
  means copying a directory.
