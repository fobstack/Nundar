import type { ShellProps } from "@/themes/contract";
import { Footer } from "./Footer";
import { Header } from "./Header";
import "../tokens.css";

export function Shell({ locale, currency, t, urls, children }: ShellProps) {
  return (
    <div className="theme-editorial">
      <Header locale={locale} currency={currency} t={t} urls={urls} />
      <main style={{ flexGrow: 1 }}>{children}</main>
      <Footer locale={locale} t={t} urls={urls} />
    </div>
  );
}
