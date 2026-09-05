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

const COPY = {
  en: {
    features: "Why this product",
    applications: "Applications",
    applicationsAside: "Where it is specified, and why",
  },
  de: {
    features: "Produktmerkmale",
    applications: "Anwendungen",
    applicationsAside: "Wo dieses Produkt eingesetzt wird",
  },
  fr: {
    features: "Points forts",
    applications: "Applications",
    applicationsAside: "Où ce produit est spécifié, et pourquoi",
  },
  es: {
    features: "Características",
    applications: "Aplicaciones",
    applicationsAside: "Dónde se especifica este producto y por qué",
  },
} as const;

export function ProductDetailView({
  locale,
  currency,
  product,
  t,
  urls,
}: ProductDetailViewProps) {
  const copy = COPY[locale];

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
        <Link href={urls.products}>{t.nav.products}</Link>
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
                        : t.product.priceOnRequest}
                    </div>
                    <div style={{ marginTop: 5, fontSize: "var(--text-xs)", color: "var(--ink-3)" }}>
                      {t.product.perUnitNet}
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
                      {t.product.minimumOrder}
                    </dt>
                    <dd className="mono" style={{ margin: "4px 0 0", fontSize: 15, fontWeight: 600 }}>
                      {variant.moq}
                    </dd>
                  </div>
                  <div style={{ padding: "var(--space-3) var(--space-6)", borderRight: "1px solid var(--line)" }}>
                    <dt style={{ fontSize: "var(--text-eyebrow)", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--ink-3)" }}>
                      {t.product.leadTime}
                    </dt>
                    <dd className="mono" style={{ margin: "4px 0 0", fontSize: 15, fontWeight: 600 }}>
                      {variant.leadTimeDaysMin && variant.leadTimeDaysMax
                        ? `${variant.leadTimeDaysMin}–${variant.leadTimeDaysMax} ${t.product.businessDays}`
                        : "—"}
                    </dd>
                  </div>
                  <div style={{ padding: "var(--space-3) var(--space-6)" }}>
                    <dt style={{ fontSize: "var(--text-eyebrow)", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--ink-3)" }}>
                      {t.product.stock}
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
          <SectionHead title={copy.features} />
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
          <SectionHead title={copy.applications} aside={copy.applicationsAside} />
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
                    {useCase.specHighlights?.sector ?? copy.applications}
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
                      {t.useCase.readMore}
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
