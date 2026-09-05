import Link from "next/link";
import { AddToCart } from "@/components/AddToCart";
import { LiveStock } from "@/components/LiveStock";
import { Markdown } from "@/components/Markdown";
import type { Locale } from "@/config/locales";
import { formatMoney } from "@/lib/money";
import type { ProductDetailViewProps } from "@/themes/contract";
import { Card, Eyebrow, SectionHead, Stat, StockDot } from "../components/primitives";

/** Theme voice. Commerce vocabulary comes from `t`. */
const COPY: Record<Locale, { features: string; applications: string; applicationsAside: string }> = {
  en: {
    features: "What makes it different",
    applications: "Where it is used",
    applicationsAside: "Notes from real installations",
  },
  de: {
    features: "Was es auszeichnet",
    applications: "Wo es eingesetzt wird",
    applicationsAside: "Notizen aus realen Anlagen",
  },
  fr: {
    features: "Ce qui le distingue",
    applications: "Où il est utilisé",
    applicationsAside: "Notes d'installations réelles",
  },
  es: {
    features: "Qué lo distingue",
    applications: "Dónde se utiliza",
    applicationsAside: "Notas de instalaciones reales",
  },
};

export function ProductDetailView({
  locale,
  currency,
  product,
  t,
  urls,
}: ProductDetailViewProps) {
  const copy = COPY[locale];
  const pages = product.useCases.filter((useCase) => useCase.hasOwnPage && useCase.scenarioSlug);

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
        <span>{product.name}</span>
      </div>

      <div className="shell" style={{ paddingTop: "var(--space-8)" }}>
        <header style={{ maxWidth: "var(--measure)" }}>
          <h1
            className="serif"
            style={{
              margin: 0,
              fontSize: "var(--text-h1)",
              fontWeight: 600,
              lineHeight: 1.15,
              letterSpacing: "-0.02em",
            }}
          >
            {product.name}
          </h1>
          {product.summary ? (
            <p
              className="serif"
              style={{
                margin: "var(--space-4) 0 0",
                fontSize: "var(--text-lg)",
                lineHeight: 1.7,
                color: "var(--ink-2)",
              }}
            >
              {product.summary}
            </p>
          ) : null}
        </header>

        {/* SKU cards. Each carries the data-variant-id / data-price / data-stock
            hooks LiveStock patches after hydration — a theme that omits them
            still compiles and still renders, but silently stops showing live
            stock. See the note on those attributes in the theme contract. */}
        <section
          style={{
            marginTop: "var(--space-12)",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
            gap: "var(--space-6)",
          }}
        >
          {product.variants.map((variant) => (
            <Card key={variant.id} lifted>
              <div data-variant-id={variant.id}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    gap: "var(--space-4)",
                  }}
                >
                  <span className="mono" style={{ fontSize: "var(--text-sm)", color: "var(--ink-3)" }}>
                    {variant.sku}
                  </span>
                  <span
                    data-price
                    className="serif"
                    style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-0.02em" }}
                  >
                    {variant.priceMinor !== null && variant.priceCurrency
                      ? formatMoney(variant.priceMinor, variant.priceCurrency, locale)
                      : t.product.priceOnRequest}
                  </span>
                </div>

                {Object.keys(variant.optionValues).length > 0 ? (
                  <div
                    style={{
                      marginTop: "var(--space-2)",
                      fontSize: "var(--text-sm)",
                      color: "var(--ink-3)",
                    }}
                  >
                    {Object.entries(variant.optionValues)
                      .map(([key, value]) => `${key}: ${value}`)
                      .join(" · ")}
                  </div>
                ) : null}

                <div
                  style={{
                    marginTop: "var(--space-6)",
                    display: "flex",
                    gap: "var(--space-8)",
                    flexWrap: "wrap",
                  }}
                >
                  <Stat label={t.product.minimumOrder}>
                    <span className="mono">{variant.moq}</span>
                  </Stat>
                  {variant.leadTimeDaysMin && variant.leadTimeDaysMax ? (
                    <Stat label={t.product.leadTime}>
                      <span className="mono">
                        {variant.leadTimeDaysMin}–{variant.leadTimeDaysMax}
                      </span>{" "}
                      <span style={{ fontSize: "var(--text-sm)", color: "var(--ink-3)" }}>
                        {t.product.businessDays}
                      </span>
                    </Stat>
                  ) : null}
                  <Stat label={t.product.stock}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <StockDot stock={variant.stock} />
                      <span data-stock className="mono">
                        {variant.stock}
                      </span>
                    </span>
                  </Stat>
                </div>

                <div style={{ marginTop: "var(--space-6)" }}>
                  <AddToCart
                    variantId={variant.id}
                    moq={variant.moq}
                    stock={variant.stock}
                    locale={locale}
                  />
                </div>

                <div
                  style={{
                    marginTop: "var(--space-3)",
                    fontSize: "var(--text-xs)",
                    color: "var(--ink-3)",
                  }}
                >
                  {t.product.perUnitNet}
                </div>
              </div>
            </Card>
          ))}
        </section>

        {product.description ? (
          <section style={{ marginTop: "var(--space-16)" }}>
            <div className="prose">
              <Markdown source={product.description} />
            </div>
          </section>
        ) : null}

        {product.features.length > 0 ? (
          <section style={{ marginTop: "var(--space-16)" }}>
            <SectionHead title={copy.features} />
            <div
              style={{
                marginTop: "var(--space-8)",
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
                gap: "var(--space-8)",
              }}
            >
              {product.features.map((feature) => (
                <div key={feature.id}>
                  <h3
                    className="serif"
                    style={{ margin: 0, fontSize: "var(--text-h3)", fontWeight: 600 }}
                  >
                    {feature.title}
                  </h3>
                  {feature.body ? (
                    <p
                      style={{
                        margin: "var(--space-3) 0 0",
                        fontSize: "var(--text-sm)",
                        lineHeight: 1.7,
                        color: "var(--ink-2)",
                      }}
                    >
                      {feature.body}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {product.useCases.length > 0 ? (
          <section style={{ marginTop: "var(--space-16)" }}>
            <SectionHead title={copy.applications} aside={copy.applicationsAside} />
            <div
              style={{
                marginTop: "var(--space-8)",
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
                gap: "var(--space-6)",
              }}
            >
              {product.useCases.map((useCase) => {
                const body = (
                  <Card style={{ height: "100%" }} lifted={useCase.hasOwnPage}>
                    <Eyebrow>{useCase.specHighlights?.sector ?? copy.applications}</Eyebrow>
                    <h3
                      className="serif"
                      style={{
                        margin: "var(--space-3) 0 0",
                        fontSize: "var(--text-h3)",
                        fontWeight: 600,
                        lineHeight: 1.3,
                      }}
                    >
                      {useCase.scenarioTitle}
                    </h3>
                    {useCase.hasOwnPage && useCase.scenarioSlug ? (
                      <div
                        style={{
                          marginTop: "var(--space-4)",
                          fontSize: "var(--text-sm)",
                          color: "var(--accent)",
                        }}
                      >
                        {t.useCase.readMore} →
                      </div>
                    ) : null}
                  </Card>
                );

                return useCase.hasOwnPage && useCase.scenarioSlug ? (
                  <Link key={useCase.id} href={urls.useCase(useCase.scenarioSlug)}>
                    {body}
                  </Link>
                ) : (
                  <div key={useCase.id}>{body}</div>
                );
              })}
            </div>
          </section>
        ) : null}

        {pages.length === 0 ? null : <div style={{ height: "var(--space-8)" }} />}
      </div>
    </>
  );
}
