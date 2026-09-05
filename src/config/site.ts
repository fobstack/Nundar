/**
 * Site-level configuration.
 *
 * SITE.url must be an absolute origin with no trailing slash: canonicals and
 * hreflang are both built from it. Set NEXT_PUBLIC_SITE_URL before deploying to
 * a real domain, or the live pages emit localhost canonicals and the whole site
 * fails to index.
 */
const rawUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const SITE = {
  url: rawUrl.replace(/\/+$/, ""),
  name: "Nundar",
} as const;
