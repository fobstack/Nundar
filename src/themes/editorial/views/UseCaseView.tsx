import Link from "next/link";
import { Markdown } from "@/components/Markdown";
import { formatMoney } from "@/lib/money";
import type { UseCaseViewProps } from "@/themes/contract";
import { ButtonLink, Card, Eyebrow, Stat, StockDot } from "../components/primitives";

export function UseCaseView({
  locale,
  product,
  useCase,
  siblings,
  t,
  urls,
}: UseCaseViewProps) {
  const cheapest = product.variants
    .filter((variant) => variant.priceMinor !== null)
    .sort((a, b) => (a.priceMinor ?? 0) - (b.priceMinor ?? 0))[0];

  return (
    <div className="shell" style={{ paddingTop: "var(--space-8)" }}>
      <div
        style={{
          fontSize: "var(--text-xs)",
          color: "var(--ink-3)",
          display: "flex",
          gap: "var(--space-2)",
          flexWrap: "wrap",
        }}
      >
        <Link href={urls.products}>{t.nav.products}</Link>
        <span>/</span>
        <Link href={urls.product}>{product.name}</Link>
      </div>

      {/* One centred column rather than the default theme's article-plus-rail.
          This page exists to be read end to end, and a rail alongside it
          competes with the reading. The product is offered after the argument,
          not beside it. */}
      <article
        style={{
          margin: "var(--space-12) auto 0",
          maxWidth: "var(--measure)",
        }}
      >
        <Eyebrow>{t.useCase.note}</Eyebrow>
        <h1
          className="serif"
          style={{
            margin: "var(--space-4) 0 0",
            fontSize: "var(--text-h1)",
            fontWeight: 600,
            lineHeight: 1.15,
            letterSpacing: "-0.02em",
          }}
        >
          {useCase.scenarioTitle}
        </h1>

        {useCase.specHighlights && Object.keys(useCase.specHighlights).length > 0 ? (
          <dl
            style={{
              margin: "var(--space-8) 0 0",
              padding: "var(--space-6) 0",
              borderTop: "1px solid var(--line)",
              borderBottom: "1px solid var(--line)",
              display: "flex",
              gap: "var(--space-8)",
              flexWrap: "wrap",
            }}
          >
            {Object.entries(useCase.specHighlights).map(([key, value]) => (
              <div key={key}>
                <dt
                  style={{
                    fontSize: "var(--text-xs)",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    color: "var(--ink-3)",
                  }}
                >
                  {key}
                </dt>
                <dd className="mono" style={{ margin: "2px 0 0", fontSize: "var(--text-sm)" }}>
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}

        {useCase.body ? (
          <div className="prose" style={{ marginTop: "var(--space-8)" }}>
            <Markdown source={useCase.body} />
          </div>
        ) : null}
      </article>

      <section style={{ margin: "var(--space-16) auto 0", maxWidth: "var(--measure)" }}>
        <Card lifted>
          <Eyebrow>{t.useCase.thePart}</Eyebrow>
          <h2
            className="serif"
            style={{
              margin: "var(--space-3) 0 0",
              fontSize: "var(--text-h2)",
              fontWeight: 600,
              lineHeight: 1.25,
            }}
          >
            <Link href={urls.product}>{product.name}</Link>
          </h2>

          {cheapest ? (
            <div
              style={{
                marginTop: "var(--space-6)",
                display: "flex",
                gap: "var(--space-8)",
                flexWrap: "wrap",
                alignItems: "flex-start",
              }}
            >
              <Stat label={t.product.perUnit}>
                <span className="serif" style={{ fontWeight: 600 }}>
                  {cheapest.priceMinor !== null && cheapest.priceCurrency
                    ? formatMoney(cheapest.priceMinor, cheapest.priceCurrency, locale)
                    : t.product.priceOnRequest}
                </span>
              </Stat>
              <Stat label={t.product.minimumOrder}>
                <span className="mono">{cheapest.moq}</span>
              </Stat>
              {cheapest.leadTimeDaysMin && cheapest.leadTimeDaysMax ? (
                <Stat label={t.product.leadTime}>
                  <span className="mono">
                    {cheapest.leadTimeDaysMin}–{cheapest.leadTimeDaysMax}
                  </span>{" "}
                  <span style={{ fontSize: "var(--text-sm)", color: "var(--ink-3)" }}>
                    {t.product.businessDays}
                  </span>
                </Stat>
              ) : null}
              <Stat label={t.product.stock}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <StockDot stock={cheapest.stock} />
                  <span className="mono">{cheapest.stock}</span>
                </span>
              </Stat>
            </div>
          ) : null}

          <div style={{ marginTop: "var(--space-8)" }}>
            <ButtonLink href={urls.product}>{t.product.viewProduct}</ButtonLink>
          </div>
        </Card>
      </section>

      {siblings.length > 0 ? (
        <section style={{ margin: "var(--space-16) auto 0", maxWidth: "var(--measure)" }}>
          <h2
            className="serif"
            style={{ margin: 0, fontSize: "var(--text-h3)", fontWeight: 600 }}
          >
            {t.useCase.otherApplications}
          </h2>
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
            {siblings.map((sibling) => (
              <li key={sibling.href}>
                <Link href={sibling.href} className="serif" style={{ fontSize: "var(--text-lg)" }}>
                  {sibling.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
