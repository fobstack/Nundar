# The sample theme: a titanium fastener catalogue

> Date: 2026-10-06
> Design: `docs/superpowers/specs/2026-09-30-nundar-on-mallok-design.md` §4.1, §12, §15
> Builds on: `mallok@0.1.0-rc.9`

## Goal

Phase 1A left the commerce theme with one product, one application note, one collection and a contact page: enough to prove the contracts, not enough to show what a shop on Nundar looks like. The owner supplied a complete design for a titanium fastener supplier, built as a React single-page application, and asked for it to become Nundar's theme and sample catalogue.

This is that port. It replaces the theme's look and all of the sample content. It is not a phase of the plan in the design's §9, and it changes nothing in the shop plugin.

What a port means here: the design, the content and the structure are the template's; the way they are delivered is Nundar's. A page is HTML rendered on the server from content, in four languages, with its own URL — not a view inside an application.

## What was built

**The theme (`src/theme/`)**
- Thirteen layouts and six partials, restricted Liquid: the home page, the catalogue, product, collection, industry, case study, questions (one topic, and all topics on the list page), engineering reference, plain page, article and generic list.
- One hand-written stylesheet, no framework and no build step. The same design tokens as the template: a dark header and hero, a warm paper background, an amber accent that the site owner can change.
- Three type families served from the site itself, as `woff2` in two subsets each, under the SIL Open Font License, with each file's source and checksum recorded beside it. Two are preloaded.
- Four images of its own (hero, hero background, closing band, the drawing on the home page), as `webp`.
- Icons are inline SVG paths drawn for this theme.
- Language packs with 68 interface strings in English, German, French and Spanish.
- Thirty-two options. Every word a visitor reads that belongs to the site rather than to the theme is one of them: the home page's headline, its three selling points, the custom manufacturing panel, the quality panel, the closing band, the footer, the addresses behind the buttons.

**The content model (`src/theme/theme.json`)**
- `product` gained `facets` (the attributes a buyer filters by) and `sizes` (each SKU and what distinguishes it), and lost `material` and `standard`, which are now ordinary rows of `specs`.
- `application` is unchanged as a kind. The sample uses it for industry pages and gives it the address `/industries`.
- Three kinds are new: `case` (a case study, with a sector, the product used and the measured results), `faq` (questions and answers; Mallok publishes them as structured data) and `tool` (an engineering reference page).

**The specification finder (`partials/spec-table.liquid`)**
- One table, used on the home page, in the catalogue, on a collection page and for a product's neighbours: a row per product, a column per attribute, the sizes on offer, a link.
- Its columns are the attribute names of the first product that has any, and every row is filled by name. A product that lacks an attribute leaves a cell empty; nothing shifts.
- Below 72rem the same markup is laid out as one card per product, each value labelled; two cards to a row on a tablet. Seven columns need about 1100 pixels in German, and a table that scrolls sideways hides the columns a buyer is comparing.

**The sample catalogue (`content/`, `seed/`, `site.json`)**
- 31 bundles, each in four languages: six products, five collections, five industry pages, four case studies, two question topics, eight pages, one engineering reference. 124 Markdown files, 25 images.
- The template's nine SKUs are six products: the four lengths of the M5 cap screw are sizes of one product, not four pages.
- Nine variants in `seed/shop-sample.sql`, one for each SKU a product page lists, with base prices in USD. One is made to order.
- `site.json` holds the navigation and the site's copy for all four languages.
- The engineering reference gives, for each of the template's three calculators, the formula, every constant and tables of results. The tables were generated from the template's own formulas and checked cell by cell by a second, independent computation.

**The checks that did not exist before**
- `test/theme/pages.test.ts` renders every layout from content it creates itself, pictures and a second page of a list included: 80 tests.
- `test/theme/bare.test.ts` renders the same layouts for a site that has filled in almost nothing — options cleared, a product that is a title and no more, a reference that names nothing — and fails on any empty element, any link without an address, any page without one main heading: 79 tests.
- `test/content.test.ts` holds the sample together: every bundle in every language, references and body links that resolve within a language, images that exist, the same attributes on every product, the same SKUs in every language, one seeded variant per SKU, identity files in step, and every address in `site.json` naming a real page.
- `test/project.test.ts` holds `site.json` together: only options the theme has, every language with its own words for each, links that stay inside their language, the same navigation everywhere.
- `scripts/smoke-shop.mjs` publishes the real sample and requests every kind of page, follows every header and footer link in all four languages, and fetches the stylesheet, a font and an image.

## What the template had that was not ported, and why

| In the template | Here | Why |
|---|---|---|
| Filters above the specification finder | The whole table, unfiltered | Needs a script. Six products can be read without one; the filters are a later, separate change |
| Three interactive calculators | A reference page with the formulas, the constants and tables | Needs a script. The page is complete without one, and every figure can be checked by hand |
| A quote list in a drawer, with quantities | The request-a-quote buttons lead to the custom manufacturing page and its form | This is the cart, and the cart page waits for Mallok (design §7) |
| A search box in the header | — | Mallok has no search |
| Forms with file upload, a wizard, a heat-lot lookup | Mallok's inquiry form, text only | The template's forms sent nothing anywhere; the inquiry form is real, and it takes text |
| Per-page titles and descriptions set by a script | Each page's own title and description, from its content | Mallok's core |
| Two of its product photographs | Left out | One showed an armoured vehicle, the other sewing thread |

Three image addresses in the template answered with an error and could not be fetched. One drawing had a person's name in its title block; it is blank in the copy here. One photograph was cropped to remove a manufacturer's logo.

## How it was verified

| Check | Result |
|---|---|
| `npm run lint`, `npm run typecheck` | Pass |
| `npm run test:project` | 22 of 22 |
| `npm run test:shop` | 418 of 418, inside workerd; 159 of them the theme's |
| `npm run build` | Pass; 407 KiB gzip, 9 KiB more than before |
| `npm run smoke`, `npm run smoke:shop` | Pass, on a real local Worker: 124 items published with their images, 56 header and footer links followed, all 15 of the theme's files fetched |
| Every page at thirteen widths | 156 pages, 320 to 1920 pixels: none scrolls sideways, and no specification table does |

**Red and green.** Each new check was seen failing for the reason it exists:

- *The theme.* 114 changes were made to the templates, the manifest and the language packs, one at a time — a section dropped, an option ignored, a link built wrongly, a fallback removed, an empty wrapper let through — and the tests run after each. All 114 were noticed, each by the test meant for it. Six were at first noticed by no test: three because the text looked for also appeared somewhere else on the page, three because no test content had a card beside a text that was never written. The assertions now look in the one place, and that content exists.
- *The content.* The sample was broken 25 ways — a language removed, a reference left in English, a link to a page that is gone, a renamed attribute, a SKU with no variant, two bundles sharing an identity. All 25 were reported by the check meant for them.
- *The settings.* `site.json` was broken 8 ways. All 8 were reported.
- *The smoke run.* Run with the inquiry plugin left off, and with a token that cannot upload media. Both runs failed, at the contact form and at the first image.

**By eye, and by measurement.** Every layout was looked at in a browser at 1440, 1280, 768 and 375 pixels wide, in English and, for the header, the catalogue and the reference page, in the other three languages. After the review below, all 156 pages of the sample were loaded at thirteen widths each and measured for anything wider than its container.

**By an independent reviewer.** The finished theme went to a reviewer who was told what to look for and nothing about what had been done. It came back with twenty-three confirmed defects and a list of assertions that would pass with their behaviour broken. All of it is fixed; what it taught is below.

**Not verified.** No automated browser test exists; the looking and the measuring were done by hand, in one browser engine. Nothing was tried with a screen reader. No measurement was taken of rendering time, page weight on a slow connection or Core Web Vitals. Nothing was deployed.

## What implementation uncovered

**About the theme**
- *A table's header cannot be taken from its first row.* The newest product is first, and a product with no attributes there removed every column's heading while the cells below stayed. Found by the first run of the tests.
- *A hidden element can widen a page.* Visually hidden text inside a table that scrolls sideways is positioned, and a positioned element is clipped only by a box that contains it. At 768px the page scrolled sideways by four pixels.
- *A custom property resolves where it is declared.* The accent colour was set on `<body>` and the tints derived from it in a `:root` rule, which computed them from the default.
- *A header that fits with one language overflows with four.* Ten links and a button fitted at 1280px until the pages had other languages to switch to; with the language control beside them the line overflowed in every language, by about 130 pixels in German. The button's wording is now shorter there, the closed control shows the language's code, and two German labels were shortened. German still has the least room to spare.
- *A column's alignment in Markdown arrives as an attribute*, and a blanket `text-align` in the stylesheet silently wins over it.
- *A card grid with a fixed number of cards wants a fixed number of columns.* Three related items in a grid that fills by width left an empty fourth column.

**About the theme, from the independent review**
- *English fits; German overflows.* A grid column left to `auto` is as wide as its longest word, and a table column as wide as its longest cell. German compound words pushed pages past the edge of a phone, by up to 90 pixels, and no English page showed it. Every single-column grid is now `minmax(0, 1fr)`, tables in cards have fixed columns, and long words are hyphenated.
- *A table that scrolls is a table that hides.* Between 768 and about 1340 pixels the specification table kept its columns and scrolled sideways, which put the sizes and the link out of sight — the reason it had been turned into cards on a phone. It is cards below 1152 pixels now.
- *An empty option is not the absence of its section.* A wrapper printed around a value prints around nothing when the value is cleared: an empty headline, a row of no buttons, a link with no address, half a page of blank column. A second test file now renders a site that has filled in almost nothing, and fails on any empty element.
- *`content.html` is not a string.* Comparing it with one is always unequal, so "if there is a body" was always true. The body is captured first.
- *Liquid answers `size`, `first` and `last` on any map.* An attribute called "size" put a count in the cell of every product that lacked one. Values are found by walking the product's own attributes.
- *A label on a control replaces what the control says.* The language switcher was labelled "Language", so that was all a screen reader announced, on every page, whatever the language. The label is now words inside the control.
- *A control that does nothing must not take focus.* The checkbox behind the folded menu was still a stop for the Tab key on a desktop, where there is no folded menu, with no visible focus.
- *An address appears in more than one place.* A test that looks for a German URL anywhere on a page is satisfied by the language switcher and says nothing about hreflang; one that looks for a link to a product is satisfied by a link in the text and says nothing about the card built from a reference. Each now names the element it is about.
- *Colour that is nearly enough is not enough.* Grey text on the darkest and the warmest backgrounds measured 4.18 and 4.49 against a required 4.5, and the amber focus ring 2.96 against 3 on white. The footer's small print, the section notes, the ring on light surfaces and the form's field borders were changed, and each new pair was computed.

**About the content**
- *A link in a Markdown body is not a reference.* Mallok resolves a `reference` field per language and leaves a link alone, so a translation that kept an English path would have linked out of its language without any error. This is now checked.
- *A number has to survive translation digit for digit.* The translations use each language's separators. Every translated file was compared with its source number by number, ignoring separators, before it was accepted.
- *The template contradicts itself*, and the port kept what the more specific place said. What remains is listed under "What waits".

**About Mallok** — each is in the task list handed to Mallok, none is worked around outside its documented contracts:
- The inquiry form's labels exist in English and Chinese. On a German, French or Spanish contact page they are English.
- The site's tagline, and so the home page's description, is one string for every language. Two theme options stand in front of it.
- A kind with an address and no list layout answers that address with a server error.
- A template cannot link to the list page of its own kind, so a breadcrumb cannot name the section a page is in, and the link from the home page's finder to the full catalogue takes its address from a theme option. The home page is given the ten newest items of a kind and no more.
- Locally, switching a plugin on or off, or changing the navigation, leaves pages already cached as they were.
- Publishing a bundle with images needs a token with the `media:write` scope. This repository's own instructions did not say so.

## What waits

**For a decision by the owner**
- *The sample's facts.* These come from the template and disagree with each other; none was changed, because which is right is not a question a port can answer: the density of stainless steel (7.93, 7.98 and 8.00 g/cm³ in different places); the weight saved (44% and 45%, where the densities give 43.6% and 44.6%); the iron limit of Grade 5 (0.40% in the material guide, 0.30% for AMS 4928 on the quality page); "Grade 5 ELI" in one case study, where ELI is Grade 23 elsewhere; a UNJ thread form named for metric threads; a shoulder screw of "custom alloy" that a case study calls Grade 5; a stainless steel passivation standard cited for titanium.
- *The two scripts.* Filters for the finder and the three calculators, as small scripts the theme declares, each working on a page that is complete without it.
- *The images.* They were generated for the template. Whether they are to be published under this repository's licences is the owner's to confirm.

**For Mallok** — the five items above, and everything phase 1B already waits for: prices and availability on the product pages and in the finder, and the cart page that the template's quote list becomes.

**For tooling**
- A browser test for what only a browser shows: the folded menu, the table as cards, the header's fit in each language.
- Measurements on a real deployment.
