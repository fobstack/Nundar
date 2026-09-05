import type { ShellProps } from "@/themes/contract";
import { Footer } from "./Footer";
import { Header } from "./Header";
import "../tokens.css";

export function Shell({ locale, currency, urls, children }: ShellProps) {
  return (
    <div className="theme-root">
      <Header locale={locale} currency={currency} urls={urls} />
      <main style={{ flexGrow: 1 }}>{children}</main>
      <Footer locale={locale} urls={urls} />
    </div>
  );
}
