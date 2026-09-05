import { LOCALES, type Locale } from "@/config/locales";
import { localePath } from "@/lib/seo";
import type { SiteUrls } from "@/themes/contract";

/**
 * Assemble the site paths handed to a theme.
 *
 * Paths are always computed here rather than inside themes. Themes never build
 * URLs, so changing the route structure does not mean editing every theme, and
 * a theme author cannot accidentally emit a link that drops the locale prefix.
 *
 * `pathFor` decides where a language switch lands: on the equivalent page,
 * not bounced back to the home page.
 */
export function buildSiteUrls(
  locale: Locale,
  pathFor: (target: Locale) => string | null = (target) => localePath(target),
): SiteUrls {
  const localeSwitch: Partial<Record<Locale, string>> = {};

  for (const target of LOCALES) {
    const path = pathFor(target);
    if (path) {
      localeSwitch[target] = path;
    }
  }

  return {
    home: localePath(locale),
    products: localePath(locale, "products"),
    cart: localePath(locale, "cart"),
    checkout: localePath(locale, "checkout"),
    localeSwitch,
  };
}
