import { cookies } from "next/headers";
import {
  ADMIN_LOCALE_COOKIE,
  getAdminMessages,
  parseAdminLocale,
  type AdminLocale,
  type AdminMessages,
} from "./i18n";

/**
 * Read the admin interface language and its strings.
 *
 * Kept apart from i18n.ts, which is pure data and pure functions testable
 * anywhere. This file depends on next/headers and works only inside server
 * components.
 */
export async function getAdminLocale(): Promise<AdminLocale> {
  const store = await cookies();
  return parseAdminLocale(store.get(ADMIN_LOCALE_COOKIE)?.value);
}

export async function getAdminT(): Promise<{
  locale: AdminLocale;
  t: AdminMessages;
}> {
  const locale = await getAdminLocale();
  return { locale, t: getAdminMessages(locale) };
}
