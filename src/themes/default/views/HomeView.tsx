import Link from "next/link";
import { formatMoney } from "@/lib/money";
import type { HomeViewProps } from "@/themes/contract";
import { ButtonLink, Eyebrow, Panel, SectionHead } from "../components/primitives";

const COPY = {
  en: {
    eyebrow: "Manufacturer direct",
    headline: "Spec it once.\nOrder it direct.",
    lead: "Every part lists its material grade, minimum order and real lead time before you add it to the cart — so procurement never has to email for a quote first.",
    browse: "Browse the catalogue",
    catalogue: "Catalogue",
    all: "All products",
    applications: "Application notes",
    applicationsAside: "Written by the engineers who build the parts",
  },
  de: {
    eyebrow: "Direkt vom Hersteller",
    headline: "Einmal spezifizieren.\nDirekt bestellen.",
    lead: "Jedes Teil nennt Werkstoff, Mindestbestellmenge und echte Lieferzeit schon vor dem Warenkorb — der Einkauf muss kein Angebot anfragen.",
    browse: "Katalog ansehen",
    catalogue: "Katalog",
    all: "Alle Produkte",
    applications: "Anwendungsnotizen",
    applicationsAside: "Geschrieben von den Ingenieuren, die die Teile bauen",
  },
  fr: {
    eyebrow: "Vente directe usine",
    headline: "Spécifiez une fois.\nCommandez en direct.",
    lead: "Chaque référence indique sa nuance, sa quantité minimale et son délai réel avant l'ajout au panier — les achats n'ont pas à demander un devis.",
    browse: "Voir le catalogue",
    catalogue: "Catalogue",
    all: "Tous les produits",
    applications: "Notes d'application",
    applicationsAside: "Rédigées par les ingénieurs qui fabriquent les pièces",
  },
  es: {
    eyebrow: "Venta directa de fábrica",
    headline: "Especifique una vez.\nCompre directo.",
    lead: "Cada referencia indica su material, pedido mínimo y plazo real antes de añadirla al carrito — compras no tiene que pedir presupuesto.",
    browse: "Ver el catálogo",
    catalogue: "Catálogo",
    all: "Todos los productos",
    applications: "Notas de aplicación",
    applicationsAside: "Escritas por los ingenieros que fabrican las piezas",
  },
} as const;

export function HomeView({ locale, products, applications, t, urls }: HomeViewProps) {
  const copy = COPY[locale];

  return (
    <>
      {/* No banner above the fold: a B2B buyer wants to narrow down candidates
          immediately, not look at a poster */}
      <section style={{ background: "var(--surface)", borderBottom: "1px solid var(--line)" }}>
        <div
          className="shell"
          style={{
            paddingTop: "var(--space-16)",
            paddingBottom: "var(--space-16)",
            display: "grid",
            gridTemplateColumns: "repeat(12, minmax(0, 1fr))",
            gap: "var(--space-8)",
            alignItems: "center",
          }}
        >
          <div style={{ gridColumn: "span 7" }}>
            <Eyebrow>{copy.eyebrow}</Eyebrow>
            <h1
              style={{
                margin: "var(--space-4) 0 0",
                fontSize: "var(--text-display)",
                lineHeight: 1.08,
                letterSpacing: "-0.03em",
                fontWeight: 600,
                whiteSpace: "pre-line",
                textWrap: "pretty",
              }}
            >
              {copy.headline}
            </h1>
            <p
              style={{
                margin: "var(--space-6) 0 0",
                fontSize: "var(--text-lg)",
                lineHeight: 1.6,
                color: "var(--ink-2)",
                maxWidth: "48ch",
              }}
            >
              {copy.lead}
            </p>
            <div style={{ marginTop: "var(--space-8)", display: "flex", gap: "var(--space-3)" }}>
              <ButtonLink href={urls.products}>{copy.browse}</ButtonLink>
            </div>
          </div>

          <div style={{ gridColumn: "span 5" }}>
            <Panel style={{ background: "var(--bg)", padding: "var(--space-8)" }}>
              <div
                style={{
                  fontSize: "var(--text-xs)",
                  fontWeight: 600,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "var(--ink-2)",
                }}
              >
                {copy.catalogue}
              </div>
              <ul
                style={{
                  margin: "var(--space-4) 0 0",
                  padding: 0,
                  listStyle: "none",
                  display: "flex",
                  flexDirection: "column",
                  gap: "var(--space-3)",
                }}
              >
                {products.slice(0, 4).map((product) => (
                  <li key={product.id} style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-4)" }}>
                    <Link href={urls.product(product.slug)} style={{ fontSize: "var(--text-sm)" }}>
                      {product.name}
                    </Link>
                    <span className="mono" style={{ fontSize: "var(--text-xs)", color: "var(--ink-3)", flexShrink: 0 }}>
                      {product.fromPriceMinor !== null && product.priceCurrency
                        ? `${t.product.from} ${formatMoney(product.fromPriceMinor, product.priceCurrency, locale)}`
                        : t.product.priceOnRequest}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        </div>
      </section>

      {applications.length > 0 ? (
        <div className="shell" style={{ marginTop: "var(--space-16)" }}>
          <SectionHead title={copy.applications} aside={copy.applicationsAside} bordered={false} />
          <div
            style={{
              marginTop: "var(--space-6)",
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: "var(--space-6)",
            }}
          >
            {applications.slice(0, 6).map((application) => (
              <Panel key={application.href}>
                <Eyebrow>{application.productName}</Eyebrow>
                <h3
                  style={{
                    margin: "10px 0 0",
                    fontSize: 17,
                    fontWeight: 600,
                    lineHeight: 1.4,
                    textWrap: "pretty",
                  }}
                >
                  <Link href={application.href}>{application.title}</Link>
                </h3>
              </Panel>
            ))}
          </div>
        </div>
      ) : null}

      <div className="shell" style={{ marginTop: "var(--space-16)" }}>
        <SectionHead title={copy.catalogue} aside={<Link href={urls.products}>{copy.all} →</Link>} />
      </div>
    </>
  );
}
