import Link from "next/link";
import type { Locale } from "@/config/locales";
import { LOCALES } from "@/config/locales";
import type { SiteUrls } from "@/themes/contract";

const COPY: Record<Locale, { catalogue: string; ordering: string; company: string; language: string; blurb: string }> = {
  en: {
    catalogue: "Catalogue",
    ordering: "Ordering",
    company: "Company",
    language: "Language",
    blurb: "Manufacturer-direct industrial components, shipped from stock to Europe and North America.",
  },
  de: {
    catalogue: "Katalog",
    ordering: "Bestellung",
    company: "Unternehmen",
    language: "Sprache",
    blurb: "Industriekomponenten direkt vom Hersteller, ab Lager nach Europa und Nordamerika.",
  },
  fr: {
    catalogue: "Catalogue",
    ordering: "Commande",
    company: "Société",
    language: "Langue",
    blurb: "Composants industriels vendus en direct d'usine, expédiés du stock vers l'Europe et l'Amérique du Nord.",
  },
  es: {
    catalogue: "Catálogo",
    ordering: "Pedidos",
    company: "Empresa",
    language: "Idioma",
    blurb: "Componentes industriales directos de fábrica, enviados desde stock a Europa y Norteamérica.",
  },
};

const LOCALE_LABEL: Record<Locale, string> = {
  en: "English",
  de: "Deutsch",
  fr: "Français",
  es: "Español",
};

const columnStyle = {
  display: "flex",
  flexDirection: "column" as const,
  gap: "var(--space-2)",
  fontSize: "var(--text-sm)",
};

const headingStyle = {
  color: "var(--ink-inverse)",
  fontWeight: 600,
  fontSize: "var(--text-xs)",
};

export function Footer({ locale, urls }: { locale: Locale; urls: SiteUrls }) {
  const copy = COPY[locale];

  return (
    <footer style={{ marginTop: "var(--space-24)", background: "var(--ink)", color: "#a8aeb6" }}>
      <div
        className="shell"
        style={{
          paddingTop: "var(--space-12)",
          paddingBottom: "var(--space-12)",
          display: "grid",
          gridTemplateColumns: "repeat(12, minmax(0, 1fr))",
          gap: "var(--space-8)",
        }}
      >
        <div style={{ gridColumn: "span 4" }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: "var(--ink-inverse)", letterSpacing: "-0.02em" }}>
            shopcf
          </div>
          <p style={{ margin: "var(--space-3) 0 0", fontSize: "var(--text-sm)", lineHeight: 1.7, maxWidth: "34ch" }}>
            {copy.blurb}
          </p>
        </div>

        <div style={{ gridColumn: "span 3", ...columnStyle }}>
          <span style={headingStyle}>{copy.catalogue}</span>
          <Link href={urls.products} style={{ color: "inherit" }}>
            {copy.catalogue}
          </Link>
        </div>

        <div style={{ gridColumn: "span 2", ...columnStyle }}>
          <span style={headingStyle}>{copy.ordering}</span>
          <Link href={urls.cart} style={{ color: "inherit" }}>
            Cart
          </Link>
        </div>

        <div style={{ gridColumn: "span 3", ...columnStyle }}>
          <span style={headingStyle}>{copy.language}</span>
          {LOCALES.map((option) => {
            const href = urls.localeSwitch[option];
            return href ? (
              <Link key={option} href={href} hrefLang={option} style={{ color: "inherit" }}>
                {LOCALE_LABEL[option]}
              </Link>
            ) : null;
          })}
        </div>
      </div>

      <div style={{ borderTop: "1px solid #2b2f36" }}>
        <div
          className="shell"
          style={{
            paddingTop: 18,
            paddingBottom: 18,
            fontSize: "var(--text-xs)",
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <span>© {new Date().getFullYear()} shopcf</span>
        </div>
      </div>
    </footer>
  );
}
