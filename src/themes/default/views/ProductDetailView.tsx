import Link from "next/link";
import { AddToCart } from "@/components/AddToCart";
import { LiveStock } from "@/components/LiveStock";
import { Markdown } from "@/components/Markdown";
import { formatMoney } from "@/lib/money";
import type { ProductDetailViewProps } from "@/themes/contract";
import {
  Eyebrow,
  Panel,
  ProductPlaceholder,
  SectionHead,
  StockDot,
} from "../components/primitives";

const LABEL = {
  en: {
    minimum: "Minimum order",
    leadTime: "Lead time",
    stock: "Stock",
    days: "business days",
    inStock: "in stock",
    outOfStock: "Out of stock",
    perUnit: "per unit · excl. VAT and freight",
    features: "Why this product",
    applications: "Applications",
    applicationsAside: "Where it is specified, and why",
    readMore: "Read the full application note",
    priceOnRequest: "Price on request",
  },
  de: {
    minimum: "Mindestbestellmenge",
    leadTime: "Lieferzeit",
    stock: "Lagerbestand",
    days: "Werktage",
    inStock: "auf Lager",
    outOfStock: "Nicht auf Lager",
    perUnit: "pro Stück · zzgl. MwSt. und Fracht",
    features: "Produktmerkmale",
    applications: "Anwendungen",
    applicationsAside: "Wo dieses Produkt eingesetzt wird",
    readMore: "Vollständige Anwendungsnotiz lesen",
    priceOnRequest: "Preis auf Anfrage",
  },
  fr: {
    minimum: "Quantité minimale",
    leadTime: "Délai",
    stock: "Stock",
    days: "jours ouvrés",
    inStock: "en stock",
    outOfStock: "Rupture de stock",
    perUnit: "à l'unité · hors TVA et transport",
    features: "Points forts",
    applications: "Applications",
    applicationsAside: "Où ce produit est spécifié, et pourquoi",
    readMore: "Lire la note d'application complète",
    priceOnRequest: "Prix sur demande",
  },
  es: {
    minimum: "Pedido mínimo",
    leadTime: "Plazo de entrega",
    stock: "Existencias",
    days: "días hábiles",
    inStock: "en stock",
    outOfStock: "Sin existencias",
    perUnit: "por unidad · sin IVA ni transporte",
    features: "Características",
    applications: "Aplicaciones",
    applicationsAside: "Dónde se especifica este producto y por qué",
    readMore: "Leer la nota de aplicación completa",
    priceOnRequest: "Precio a consultar",
  },
} as const;

export function ProductDetailView({
  locale,
  currency,
  product,
  urls,
}: ProductDetailViewProps) {
  const t = LABEL[locale];

  return (
    <>
      <LiveStock
        variantIds={product.variants.map((variant) => variant.id)}
        currency={currency}
        locale={locale}
      />

      <div
        className="shell"
        style={{
          paddingTop: "var(--space-6)",
          fontSize: "var(--text-xs)",
          color: "var(--ink-3)",
          display: "flex",
          gap: "var(--space-2)",
        }}
      >
        <Link href={urls.products}>{locale === "de" ? "Produkte" : "Products"}</Link>
        <span>/</span>
        <span style={{ color: "var(--ink-2)" }}>{product.name}</span>
      </div>

      <div className="shell" style={{ paddingTop: "var(--space-6)" }}>
        <h1
          style={{
            margin: 0,
            fontSize: "var(--text-h1)",
            lineHeight: 1.2,
            letterSpacing: "-0.02em",
            fontWeight: 600,
            textWrap: "pretty",
          }}
        >
          {product.name}
        </h1>
        {product.summary ? (
          <p
            style={{
              margin: "var(--space-3) 0 0",
              fontSize: "var(--text-body)",
              lineHeight: 1.6,
              color: "var(--ink-2)",
              maxWidth: "var(--measure-lead)",
            }}
          >
            {product.summary}
          </p>
        ) : null}
      </div>

      {/* SKU cards: each variant carries its own price, MOQ, lead time, stock and
          add-to-cart */}
      <div
        className="shell"
        style={{
          marginTop: "var(--space-8)",
          display: "grid",
          gridTemplateColumns: "repeat(12, minmax(0, 1fr))",
          gap: "var(--space-8)",
        }}
      >
        <div style={{ gridColumn: "span 5" }}>
          <Panel
            padded={false}
            style={{
              aspectRatio: "4 / 3",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "var(--surface)",
            }}
          >
            <ProductPlaceholder size={220} />
          </Panel>
        </div>

        <div
          style={{
            gridColumn: "span 7",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-4)",
          }}
        >
          {product.variants.map((variant) => (
            <Panel key={variant.id} padded={false}>
              <div data-variant-id={variant.id}>
                <div
                  style={{
                    padding: "var(--space-4) var(--space-6)",
                    borderBottom: "1px solid var(--line)",
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: "var(--space-4)",
                  }}
                >
                  <div>
                    <div className="mono" style={{ fontSize: "var(--text-sm)", fontWeight: 500 }}>
                      {variant.sku}
                    </div>
                    <div
                      style={{
                        marginTop: 4,
                        fontSize: "var(--text-xs)",
                        color: "var(--ink-3)",
                      }}
                    >
                      {Object.entries(variant.optionValues)
                        .map(([key, value]) => `${key}: ${value}`)
                        .join(" · ")}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div
                      data-price
                      style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-0.02em", lineHeight: 1 }}
                    >
                      {variant.priceMinor !== null && variant.priceCurrency
                        ? formatMoney(variant.priceMinor, variant.priceCurrency, locale)
                        : t.priceOnRequest}
                    </div>
                    <div style={{ marginTop: 5, fontSize: "var(--text-xs)", color: "var(--ink-3)" }}>
                      {t.perUnit}
                    </div>
                  </div>
                </div>

                <dl
                  style={{
                    margin: 0,
                    display: "grid",
                    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                  }}
                >
                  <div style={{ padding: "var(--space-3) var(--space-6)", borderRight: "1px solid var(--line)" }}>
                    <dt style={{ fontSize: "var(--text-eyebrow)", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--ink-3)" }}>
                      {t.minimum}
                    </dt>
                    <dd className="mono" style={{ margin: "4px 0 0", fontSize: 15, fontWeight: 600 }}>
                      {variant.moq}
                    </dd>
                  </div>
                  <div style={{ padding: "var(--space-3) var(--space-6)", borderRight: "1px solid var(--line)" }}>
                    <dt style={{ fontSize: "var(--text-eyebrow)", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--ink-3)" }}>
                      {t.leadTime}
                    </dt>
                    <dd className="mono" style={{ margin: "4px 0 0", fontSize: 15, fontWeight: 600 }}>
                      {variant.leadTimeDaysMin && variant.leadTimeDaysMax
                        ? `${variant.leadTimeDaysMin}–${variant.leadTimeDaysMax} ${t.days}`
                        : "—"}
                    </dd>
                  </div>
                  <div style={{ padding: "var(--space-3) var(--space-6)" }}>
                    <dt style={{ fontSize: "var(--text-eyebrow)", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--ink-3)" }}>
                      {t.stock}
                    </dt>
                    <dd style={{ margin: "4px 0 0", fontSize: 15, fontWeight: 600, display: "flex", alignItems: "center", gap: 7 }}>
                      <StockDot stock={variant.stock} />
                      <span data-stock className="mono">{variant.stock}</span>
                    </dd>
                  </div>
                </dl>

                <div style={{ padding: "var(--space-4) var(--space-6)", borderTop: "1px solid var(--line)" }}>
                  <AddToCart
                    variantId={variant.id}
                    moq={variant.moq}
                    stock={variant.stock}
                    locale={locale}
                  />
                </div>
              </div>
            </Panel>
          ))}
        </div>
      </div>

      {product.description ? (
        <div className="shell" style={{ marginTop: "var(--space-16)" }}>
          <Markdown source={product.description} />
        </div>
      ) : null}

      {product.features.length > 0 ? (
        <div className="shell" style={{ marginTop: "var(--space-16)" }}>
          <SectionHead title={t.features} />
          <div
            style={{
              marginTop: "var(--space-6)",
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-6)",
            }}
          >
            {product.features.map((feature) => (
              <div key={feature.id} style={{ display: "flex", gap: "var(--space-4)" }}>
                <div style={{ width: 3, background: "var(--accent)", flexShrink: 0 }} />
                <div>
                  <h3 style={{ margin: 0, fontSize: "var(--text-body)", fontWeight: 600 }}>
                    {feature.title}
                  </h3>
                  {feature.body ? (
                    <p
                      style={{
                        margin: "6px 0 0",
                        fontSize: 15,
                        lineHeight: 1.65,
                        color: "var(--ink-2)",
                        maxWidth: "62ch",
                      }}
                    >
                      {feature.body}
                    </p>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {product.useCases.length > 0 ? (
        <div className="shell" style={{ marginTop: "var(--space-16)" }}>
          <SectionHead title={t.applications} aside={t.applicationsAside} />
          <div
            style={{
              marginTop: "var(--space-6)",
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: "var(--space-6)",
            }}
          >
            {product.useCases.map((useCase) => {
              const href =
                useCase.hasOwnPage && useCase.scenarioSlug
                  ? urls.useCase(useCase.scenarioSlug)
                  : null;

              return (
                <Panel key={useCase.id} style={{ padding: "var(--space-8)" }}>
                  <Eyebrow muted={!href}>
                    {useCase.specHighlights?.sector ?? t.applications}
                  </Eyebrow>
                  <h3
                    style={{
                      margin: "10px 0 0",
                      fontSize: "var(--text-h3)",
                      fontWeight: 600,
                      lineHeight: 1.35,
                      textWrap: "pretty",
                    }}
                  >
                    {href ? (
                      <Link href={href}>{useCase.scenarioTitle}</Link>
                    ) : (
                      useCase.scenarioTitle
                    )}
                  </h3>
                  {useCase.body ? (
                    <p
                      style={{
                        margin: "var(--space-3) 0 0",
                        fontSize: 15,
                        lineHeight: 1.65,
                        color: "var(--ink-2)",
                      }}
                    >
                      {useCase.body}
                    </p>
                  ) : null}
                  {href ? (
                    <div
                      style={{
                        marginTop: 18,
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: "var(--text-sm)",
                        fontWeight: 500,
                        color: "var(--accent)",
                      }}
                    >
                      {t.readMore}
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M5 12h13M13 6l6 6-6 6" />
                      </svg>
                    </div>
                  ) : null}
                </Panel>
              );
            })}
          </div>
        </div>
      ) : null}
    </>
  );
}
