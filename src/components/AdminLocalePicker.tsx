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
 * 后台界面语言切换。
 *
 * 写 cookie 后整页重载：后台全是动态渲染，服务端重新读 cookie 即可拿到新语言，
 * 不需要像前台那样处理静态页。
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
