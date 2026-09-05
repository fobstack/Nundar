import Link from "next/link";
import { LOCALES, type Locale } from "@/config/locales";

const LOCALE_LABEL: Record<Locale, string> = {
  en: "English",
  de: "Deutsch",
  fr: "Français",
  es: "Español",
};

/**
 * 语言切换。
 *
 * 纯链接，不是 JS 跳转：每个语言版本都有自己的 URL，爬虫能顺着链接抓到全部版本。
 * 用 <details> 做无 JS 下拉，禁用脚本时依然可用。
 */
export function LocalePicker({
  locale,
  urls,
}: {
  locale: Locale;
  urls: Partial<Record<Locale, string>>;
}) {
  return (
    <details style={{ position: "relative" }}>
      <summary
        style={{
          listStyle: "none",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18" />
        </svg>
        {LOCALE_LABEL[locale]}
      </summary>

      <ul
        style={{
          position: "absolute",
          top: "calc(100% + 8px)",
          right: 0,
          zIndex: 20,
          margin: 0,
          padding: "6px 0",
          listStyle: "none",
          background: "var(--surface)",
          border: "1px solid var(--line)",
          minWidth: 150,
        }}
      >
        {LOCALES.map((option) => {
          const href = urls[option];
          return (
            <li key={option}>
              {href ? (
                <Link
                  href={href}
                  hrefLang={option}
                  style={{
                    display: "block",
                    padding: "7px 14px",
                    fontSize: "var(--text-sm)",
                    color: option === locale ? "var(--ink-3)" : "var(--ink)",
                  }}
                >
                  {LOCALE_LABEL[option]}
                </Link>
              ) : null}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
