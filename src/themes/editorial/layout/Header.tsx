import Link from "next/link";
import { CurrencyPicker } from "@/components/CurrencyPicker";
import { LocalePicker } from "@/components/LocalePicker";
import type { Currency } from "@/config/currency";
import type { Locale } from "@/config/locales";
import type { StorefrontMessages } from "@/lib/storefront/i18n";
import type { SiteUrls } from "@/themes/contract";

/**
 * The theme's own voice, and the only strings it has to translate.
 *
 * Commerce vocabulary — "Products", "Minimum order", "Price on request" —
 * arrives through `t` from the shared catalogue, so this list stays at the
 * handful of lines that genuinely differ between one theme and another.
 */
const COPY: Record<Locale, { applications: string; tagline: string }> = {
  en: { applications: "Applications", tagline: "Field notes from the people who make the parts" },
  de: { applications: "Anwendungen", tagline: "Praxisberichte von den Menschen, die die Teile fertigen" },
  fr: { applications: "Applications", tagline: "Notes de terrain de ceux qui fabriquent les pièces" },
  es: { applications: "Aplicaciones", tagline: "Notas de campo de quienes fabrican las piezas" },
};

export function Header({
  locale,
  currency,
  t,
  urls,
}: {
  locale: Locale;
  currency: Currency;
  t: StorefrontMessages;
  urls: SiteUrls;
}) {
  const copy = COPY[locale];

  return (
    <header>
      <div
        className="shell"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-6)",
          paddingTop: "var(--space-6)",
          paddingBottom: "var(--space-6)",
          flexWrap: "wrap",
        }}
      >
        <Link
          href={urls.home}
          className="serif"
          style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-0.015em" }}
        >
          Nundar
        </Link>

        <nav
          style={{
            display: "flex",
            gap: "var(--space-6)",
            fontSize: "var(--text-sm)",
            alignItems: "center",
          }}
        >
          <Link href={urls.products}>{t.nav.products}</Link>
          <span style={{ color: "var(--ink-3)" }}>{copy.applications}</span>
          <Link href={urls.cart}>{t.nav.cart}</Link>
        </nav>

        <div
          style={{
            display: "flex",
            gap: "var(--space-4)",
            alignItems: "center",
            fontSize: "var(--text-xs)",
            color: "var(--ink-3)",
          }}
        >
          <LocalePicker locale={locale} urls={urls.localeSwitch} />
          <CurrencyPicker currency={currency} />
        </div>
      </div>

      <div
        className="shell"
        style={{
          paddingBottom: "var(--space-4)",
          fontSize: "var(--text-sm)",
          color: "var(--ink-3)",
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
        }}
      >
        {copy.tagline}
      </div>
    </header>
  );
}
