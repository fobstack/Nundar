import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // 交易与私有页面无 SEO 价值；带查询参数的筛选页会产生无限 URL 组合，
      // 放任爬取只会浪费爬虫预算
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
