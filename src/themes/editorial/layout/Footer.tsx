import Link from "next/link";
import { LOCALES } from "@/config/locales";
import type { Locale } from "@/config/locales";
import type { StorefrontMessages } from "@/lib/storefront/i18n";
import type { SiteUrls } from "@/themes/contract";

/** Theme voice only; every functional label comes from `t`. */
const COPY: Record<Locale, { blurb: string }> = {
  en: { blurb: "Written, specified and shipped by the people who make the parts." },
  de: { blurb: "Geschrieben, spezifiziert und versandt von den Menschen, die die Teile fertigen." },
  fr: { blurb: "Rédigé, spécifié et expédié par ceux qui fabriquent les pièces." },
  es: { blurb: "Redactado, especificado y enviado por quienes fabrican las piezas." },
};

export function Footer({
  locale,
  t,
  urls,
}: {
  locale: Locale;
  t: StorefrontMessages;
  urls: SiteUrls;
}) {
  const copy = COPY[locale];

  return (
    <footer style={{ marginTop: "var(--space-24)", borderTop: "1px solid var(--line)" }}>
      <div
        className="shell"
        style={{
          paddingTop: "var(--space-12)",
          paddingBottom: "var(--space-12)",
          display: "flex",
          gap: "var(--space-12)",
          justifyContent: "space-between",
          flexWrap: "wrap",
        }}
      >
        <div style={{ maxWidth: "38ch" }}>
          <div className="serif" style={{ fontSize: 24, fontWeight: 600 }}>
            Nundar
          </div>
          <p
            className="serif"
            style={{
              margin: "var(--space-3) 0 0",
              fontSize: "var(--text-sm)",
              color: "var(--ink-3)",
              fontStyle: "italic",
            }}
          >
            {copy.blurb}
          </p>
        </div>

        <div style={{ display: "flex", gap: "var(--space-12)", flexWrap: "wrap" }}>
          <nav
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-2)",
              fontSize: "var(--text-sm)",
            }}
          >
            <Link href={urls.products}>{t.nav.products}</Link>
            <Link href={urls.cart}>{t.nav.cart}</Link>
            <Link href={urls.checkout}>{t.nav.checkout}</Link>
          </nav>

          <nav
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-2)",
              fontSize: "var(--text-sm)",
            }}
          >
            {LOCALES.map((option) => {
              const href = urls.localeSwitch[option];
              if (!href) return null;

              return option === locale ? (
                <span key={option} style={{ color: "var(--ink-3)" }}>
                  {t.language[option]}
                </span>
              ) : (
                <Link key={option} href={href}>
                  {t.language[option]}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>
    </footer>
  );
}
