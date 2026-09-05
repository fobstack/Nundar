import { cookies } from "next/headers";
import {
  ADMIN_LOCALE_COOKIE,
  getAdminMessages,
  parseAdminLocale,
  type AdminLocale,
  type AdminMessages,
} from "./i18n";

/**
 * 读取后台界面语言与对应文案。
 *
 * 与 i18n.ts 分开：那边是纯数据与纯函数（可在任意环境测），
 * 这边依赖 next/headers，只能在服务端组件里用。
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
