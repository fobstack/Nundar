import Link from "next/link";
import type { Currency } from "@/config/currency";
import type { Locale } from "@/config/locales";
import type { SiteUrls } from "@/themes/contract";
import { CurrencyPicker } from "@/components/CurrencyPicker";
import { LocalePicker } from "@/components/LocalePicker";

const NAV_LABEL: Record<Locale, { products: string; applications: string }> = {
  en: { products: "Products", applications: "Applications" },
  de: { products: "Produkte", applications: "Anwendungen" },
  fr: { products: "Produits", applications: "Applications" },
  es: { products: "Productos", applications: "Aplicaciones" },
};

export function Header({
  locale,
  currency,
  urls,
}: {
  locale: Locale;
  currency: Currency;
  urls: SiteUrls;
}) {
  const label = NAV_LABEL[locale];

  return (
    <header>
      {/* Utility bar：语言与币种切换只在这里出现，不干扰主导航 */}
      <div style={{ background: "var(--ink)", color: "#a8aeb6", fontSize: "var(--text-xs)" }}>
        <div
          className="shell"
          style={{
            paddingTop: 8,
            paddingBottom: 8,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "var(--space-4)",
          }}
        >
          <span>Manufacturer direct · Ships worldwide from stock</span>
          <div style={{ display: "flex", gap: "var(--space-4)", alignItems: "center" }}>
            <LocalePicker locale={locale} urls={urls.localeSwitch} />
            <span style={{ color: "#4e545c" }}>|</span>
            <CurrencyPicker currency={currency} />
          </div>
        </div>
      </div>

      <div style={{ background: "var(--surface)", borderBottom: "1px solid var(--line)" }}>
        <div
          className="shell"
          style={{
            paddingTop: 20,
            paddingBottom: 20,
            display: "flex",
            alignItems: "center",
            gap: "var(--space-8)",
          }}
        >
          <Link
            href={urls.home}
            style={{
              fontSize: 20,
              fontWeight: 700,
              letterSpacing: "-0.02em",
              color: "var(--ink)",
            }}
          >
            shopcf
          </Link>

          <nav
            style={{
              flexGrow: 1,
              display: "flex",
              gap: "var(--space-6)",
              alignItems: "center",
              fontSize: "var(--text-sm)",
              fontWeight: 500,
            }}
          >
            <Link href={urls.products} style={{ color: "var(--ink)" }}>
              {label.products}
            </Link>
            <span style={{ color: "var(--ink-3)" }}>{label.applications}</span>
          </nav>

          <Link
            href={urls.cart}
            aria-label="Cart"
            style={{ display: "flex", alignItems: "center", color: "var(--ink)" }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M3 4h2l2.2 10.4a2 2 0 0 0 2 1.6h7.5a2 2 0 0 0 2-1.55L20.5 8H6" />
              <circle cx="10" cy="20" r="1.2" />
              <circle cx="18" cy="20" r="1.2" />
            </svg>
          </Link>
        </div>
      </div>
    </header>
  );
}
