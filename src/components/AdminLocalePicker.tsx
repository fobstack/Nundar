"use client";

import {
  ADMIN_LOCALES,
  ADMIN_LOCALE_COOKIE,
  ADMIN_LOCALE_COOKIE_MAX_AGE,
  type AdminLocale,
} from "@/lib/admin/i18n";

const LABEL: Record<AdminLocale, string> = {
  zh: "中文",
  en: "English",
};

/**
 * Admin interface language switcher.
 *
 * Writes the cookie and reloads the page. The admin is rendered dynamically
 * throughout, so the server simply re-reads the cookie — none of the static
 * page handling the storefront needs applies here.
 */
export function AdminLocalePicker({ locale }: { locale: AdminLocale }) {
  function choose(next: AdminLocale) {
    document.cookie = `${ADMIN_LOCALE_COOKIE}=${next}; path=/; max-age=${ADMIN_LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
    window.location.reload();
  }

  return (
    <select
      value={locale}
      onChange={(event) => choose(event.target.value as AdminLocale)}
      aria-label="Interface language"
      className="cursor-pointer border-none bg-transparent text-sm"
    >
      {ADMIN_LOCALES.map((option) => (
        <option key={option} value={option}>
          {LABEL[option]}
        </option>
      ))}
    </select>
  );
}
