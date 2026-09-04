import { redirect } from "next/navigation";
import { DEFAULT_LOCALE } from "@/config/locales";

/**
 * 根路径固定跳到默认语言，绝不依据访问者 IP 选择语言——
 * 爬虫多从美国 IP 抓取，按 IP 跳转会导致其他语言版本无法被索引。
 */
export default function RootPage() {
  redirect(`/${DEFAULT_LOCALE}`);
}
