import { LOCALES, type Locale } from "@/config/locales";
import { localePath } from "@/lib/seo";
import type { SiteUrls } from "@/themes/contract";

/**
 * 组装交给主题的站点路径。
 *
 * 路径一律在这里算好再传给主题：主题不拼 URL，将来改路由结构不用逐个主题去改，
 * 也杜绝了主题作者写出漏掉语言前缀的链接。
 *
 * `pathFor` 决定切换语言时落到哪个页面——留在当前内容上，而不是粗暴回首页。
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
