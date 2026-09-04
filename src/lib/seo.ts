import { SITE } from "@/config/site";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "@/config/locales";

/** 拼出带语言前缀的站内路径，自动清理多余斜杠 */
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
 * 生成 canonical 与完整 hreflang 集合。
 *
 * 每个页面都必须输出全部语言版本加 x-default：缺失会让 Google 把不同语言版本
 * 判为互相重复的内容，直接影响收录。canonical 一律自指——工况落地页尤其不能
 * 指向商品页，否则等于主动放弃该页排名。
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
 * 当各语言的路径片段不同（如本地化的工况 slug）时构造 alternates。
 *
 * 缺该语言 slug 时直接省略该 hreflang 条目——用别的语言 slug 顶替会指向 404，
 * 比缺条目更糟。
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
