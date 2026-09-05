import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Transactional and private pages are worth nothing to search, and filtered
      // pages with query parameters generate unbounded URL combinations that
      // would burn the crawl budget for no return
      disallow: [
        "/api/",
        "/admin",
        "/*/cart",
        "/*/checkout",
        "/*/account",
        "/*/orders/*",
        "/*?*",
      ],
    },
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
