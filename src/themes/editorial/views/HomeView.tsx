import Link from "next/link";
import { formatMoney } from "@/lib/money";
import type { Locale } from "@/config/locales";
import type { HomeViewProps } from "@/themes/contract";
import { ButtonLink, Card, Eyebrow, SectionHead } from "../components/primitives";

/**
 * The theme's voice, and nothing else.
 *
 * Six strings per language, against roughly thirty before the shared catalogue
 * existed. Everything a buyer needs to read correctly — prices, minimums, lead
 * times, navigation — arrives through `t`, so a theme author who speaks no
 * German can still ship a German-correct storefront.
 */
const COPY: Record<
  Locale,
  {
    eyebrow: string;
    headline: string;
    lead: string;
    read: string;
    notes: string;
    notesAside: string;
    catalogue: string;
    all: string;
  }
> = {
  en: {
    eyebrow: "Field notes",
    headline: "The part is easy.\nKnowing where it fits is not.",
    lead: "Every application note here was written against a real installation — the pressures, the media, the failure that prompted the specification change.",
    read: "Read the notes",
    notes: "Application notes",
    notesAside: "Written against real installations",
    catalogue: "The catalogue",
    all: "All products",
  },
  de: {
    eyebrow: "Praxisberichte",
    headline: "Das Teil ist einfach.\nDer richtige Einsatzort nicht.",
    lead: "Jede Anwendungsnotiz entstand an einer realen Anlage — die Drücke, die Medien, der Schaden, der zur Änderung der Spezifikation führte.",
    read: "Berichte lesen",
    notes: "Anwendungsnotizen",
    notesAside: "Entstanden an realen Anlagen",
    catalogue: "Der Katalog",
    all: "Alle Produkte",
  },
  fr: {
    eyebrow: "Notes de terrain",
    headline: "La pièce est simple.\nSavoir où elle va, moins.",
    lead: "Chaque note d'application a été rédigée sur une installation réelle — les pressions, les fluides, la défaillance qui a motivé le changement de spécification.",
    read: "Lire les notes",
    notes: "Notes d'application",
    notesAside: "Rédigées sur des installations réelles",
    catalogue: "Le catalogue",
    all: "Tous les produits",
  },
  es: {
    eyebrow: "Notas de campo",
    headline: "La pieza es fácil.\nSaber dónde encaja, no.",
    lead: "Cada nota de aplicación se escribió sobre una instalación real: las presiones, los fluidos, el fallo que motivó el cambio de especificación.",
    read: "Leer las notas",
    notes: "Notas de aplicación",
    notesAside: "Escritas sobre instalaciones reales",
    catalogue: "El catálogo",
    all: "Todos los productos",
  },
};

export function HomeView({ locale, products, applications, t, urls }: HomeViewProps) {
  const copy = COPY[locale];

  return (
    <div className="shell" style={{ paddingTop: "var(--space-12)" }}>
      {/* The default theme opens on the catalogue. This one opens on the
          application notes, because they are what the long-tail strategy is
          actually built on — a legitimately different editorial judgement, and
          exactly the kind of restructuring the contract has to permit. */}
      <section style={{ maxWidth: "var(--measure-lead)" }}>
        <Eyebrow>{copy.eyebrow}</Eyebrow>
        <h1
          className="serif"
          style={{
            margin: "var(--space-4) 0 0",
            fontSize: "var(--text-display)",
            fontWeight: 600,
            lineHeight: 1.08,
            letterSpacing: "-0.025em",
            whiteSpace: "pre-line",
          }}
        >
          {copy.headline}
        </h1>
        <p
          className="serif"
          style={{
            margin: "var(--space-6) 0 0",
            fontSize: "var(--text-lg)",
            lineHeight: 1.7,
            color: "var(--ink-2)",
          }}
        >
          {copy.lead}
        </p>
        <div style={{ marginTop: "var(--space-8)" }}>
          <ButtonLink href={urls.products}>{copy.read}</ButtonLink>
        </div>
      </section>

      {applications.length > 0 ? (
        <section style={{ marginTop: "var(--space-24)" }}>
          <SectionHead title={copy.notes} aside={copy.notesAside} />
          <div
            style={{
              marginTop: "var(--space-8)",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: "var(--space-6)",
            }}
          >
            {applications.map((application) => (
              <Link key={application.href} href={application.href}>
                <Card lifted style={{ height: "100%" }}>
                  <Eyebrow>{application.productName}</Eyebrow>
                  <h3
                    className="serif"
                    style={{
                      margin: "var(--space-3) 0 0",
                      fontSize: "var(--text-h3)",
                      fontWeight: 600,
                      lineHeight: 1.3,
                    }}
                  >
                    {application.title}
                  </h3>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section style={{ marginTop: "var(--space-24)" }}>
        <SectionHead
          title={copy.catalogue}
          aside={<Link href={urls.products}>{copy.all} →</Link>}
        />
        <div
          style={{
            marginTop: "var(--space-8)",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
            gap: "var(--space-6)",
          }}
        >
          {products.map((product) => (
            <Link key={product.id} href={urls.product(product.slug)}>
              <Card style={{ height: "100%" }}>
                <h3
                  className="serif"
                  style={{
                    margin: 0,
                    fontSize: "var(--text-lg)",
                    fontWeight: 600,
                    lineHeight: 1.35,
                  }}
                >
                  {product.name}
                </h3>
                <div
                  style={{
                    marginTop: "var(--space-4)",
                    fontSize: "var(--text-sm)",
                    color: "var(--ink-3)",
                  }}
                >
                  {product.fromPriceMinor !== null && product.priceCurrency
                    ? `${t.product.from} ${formatMoney(product.fromPriceMinor, product.priceCurrency, locale)}`
                    : t.product.priceOnRequest}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
