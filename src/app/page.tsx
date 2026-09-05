import { redirect } from "next/navigation";
import { DEFAULT_LOCALE } from "@/config/locales";

/**
 * The root path always redirects to the default language, and never picks one
 * from the visitor's IP. Crawlers fetch mostly from US addresses, and
 * redirecting them by IP leaves every other language version unindexed.
 */
export default function RootPage() {
  redirect(`/${DEFAULT_LOCALE}`);
}
