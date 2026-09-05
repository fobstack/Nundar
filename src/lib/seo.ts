import { SITE } from "@/config/site";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "@/config/locales";

/** Build a locale-prefixed internal path, collapsing stray slashes */
export function localePath(locale: Locale, ...segments: string[]): string {
  const parts = segments
    .flatMap((segment) => segment.split("/"))
    .map((part) => part.trim())
    .filter(Boolean);

  return `/${[locale, ...parts].join("/")}`;
}

export function absoluteUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${SITE.url}${normalized}`;
}

export type Alternates = {
  canonical: string;
  languages: Record<string, string>;
};

/**
 * Build the canonical URL and the complete set of hreflang alternates.
 *
 * Every page must emit all language versions plus x-default. Omitting them
 * lets Google treat the translations as duplicates of one another, which
 * costs indexing outright.
 *
 * The canonical is always self-referencing. Application landing pages in
 * particular must not point at the product page: doing so forfeits the very
 * ranking the page exists to win.
 */
export function buildAlternates(
  currentLocale: Locale,
  pathForLocale: (locale: Locale) => string,
): Alternates {
  const languages: Record<string, string> = {};

  for (const locale of LOCALES) {
    languages[locale] = absoluteUrl(pathForLocale(locale));
  }
  languages["x-default"] = absoluteUrl(pathForLocale(DEFAULT_LOCALE));

  return {
    canonical: absoluteUrl(pathForLocale(currentLocale)),
    languages,
  };
}

/**
 * Build alternates when the path segment differs per language, as it does for
 * localised application slugs.
 *
 * If a language has no slug, its hreflang entry is omitted entirely.
 * Substituting another language's slug would point crawlers at a 404, which is
 * worse than a missing entry.
 */
export function buildAlternatesFromMap(
  currentLocale: Locale,
  slugByLocale: Partial<Record<Locale, string>>,
  pathFor: (locale: Locale, slug: string) => string,
): Alternates {
  const languages: Record<string, string> = {};

  for (const locale of LOCALES) {
    const slug = slugByLocale[locale];
    if (slug) {
      languages[locale] = absoluteUrl(pathFor(locale, slug));
    }
  }

  const defaultSlug = slugByLocale[DEFAULT_LOCALE];
  if (defaultSlug) {
    languages["x-default"] = absoluteUrl(pathFor(DEFAULT_LOCALE, defaultSlug));
  }

  const currentSlug = slugByLocale[currentLocale];

  return {
    canonical: currentSlug
      ? absoluteUrl(pathFor(currentLocale, currentSlug))
      : absoluteUrl(pathFor(currentLocale, "")),
    languages,
  };
}
