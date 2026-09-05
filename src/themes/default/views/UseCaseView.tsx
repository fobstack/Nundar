import Link from "next/link";
import { Markdown } from "@/components/Markdown";
import { formatMoney } from "@/lib/money";
import type { UseCaseViewProps } from "@/themes/contract";
import { Eyebrow, Panel, ProductPlaceholder, StockDot } from "../components/primitives";

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
    <div
      className="shell"
      style={{
        paddingTop: "var(--space-8)",
        display: "grid",
        gridTemplateColumns: "repeat(12, minmax(0, 1fr))",
        gap: "var(--space-12)",
      }}
    >
      {/* Body column, width bound by --measure: this page exists to be read through */}
      <article style={{ gridColumn: "span 8" }}>
        <div style={{ fontSize: "var(--text-xs)", color: "var(--ink-3)", display: "flex", gap: "var(--space-2)" }}>
          <Link href={urls.products}>{t.nav.products}</Link>
          <span>/</span>
          <Link href={urls.product}>{product.name}</Link>
        </div>

        <div style={{ marginTop: "var(--space-6)" }}>
          <Eyebrow>{t.useCase.note}</Eyebrow>
        </div>

        <h1
          style={{
            margin: "var(--space-3) 0 0",
            fontSize: 40,
            lineHeight: 1.15,
            letterSpacing: "-0.025em",
            fontWeight: 600,
            textWrap: "pretty",
            maxWidth: "20ch",
          }}
        >
          {useCase.scenarioTitle}
        </h1>

        {useCase.body ? (
          <div style={{ marginTop: "var(--space-8)" }}>
            <Markdown source={useCase.body} />
          </div>
        ) : null}

        {useCase.specHighlights ? (
          <table style={{ marginTop: "var(--space-12)", borderCollapse: "collapse", width: "100%", maxWidth: "var(--measure)", fontSize: "var(--text-sm)" }}>
            <tbody>
              {Object.entries(useCase.specHighlights).map(([key, value]) => (
                <tr key={key} style={{ borderBottom: "1px solid var(--line)" }}>
                  <th style={{ textAlign: "left", padding: "10px 12px 10px 0", color: "var(--ink-3)", fontWeight: 400 }}>
                    {key}
                  </th>
                  <td className="mono" style={{ padding: "10px 0" }}>{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </article>

      {/* Product rail: the page has to convert as well as read well */}
      <aside style={{ gridColumn: "span 4" }}>
        <Panel padded={false}>
          <div
            style={{
              padding: "var(--space-4) var(--space-6)",
              borderBottom: "1px solid var(--line)",
              fontSize: "var(--text-eyebrow)",
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--ink-2)",
            }}
          >
            {t.useCase.thePart}
          </div>
          <div style={{ padding: "var(--space-6)" }}>
            <div
              style={{
                height: 120,
                border: "1px solid var(--line)",
                background: "var(--bg)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <ProductPlaceholder size={110} />
            </div>

            <h2 style={{ margin: "var(--space-4) 0 0", fontSize: 17, fontWeight: 600, lineHeight: 1.35 }}>
              <Link href={urls.product}>{product.name}</Link>
            </h2>

            {cheapest ? (
              <>
                <div style={{ marginTop: "var(--space-3)", display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-0.01em" }}>
                    {cheapest.priceMinor !== null && cheapest.priceCurrency
                      ? formatMoney(cheapest.priceMinor, cheapest.priceCurrency, locale)
                      : t.product.priceOnRequest}
                  </span>
                  <span style={{ fontSize: "var(--text-xs)", color: "var(--ink-3)" }}>{t.product.perUnit}</span>
                </div>

                <dl style={{ margin: "var(--space-4) 0 0", display: "flex", flexDirection: "column", gap: 8, fontSize: "var(--text-xs)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <dt style={{ color: "var(--ink-3)" }}>{t.product.minimumOrder}</dt>
                    <dd className="mono" style={{ margin: 0 }}>{cheapest.moq}</dd>
                  </div>
                  {cheapest.leadTimeDaysMin && cheapest.leadTimeDaysMax ? (
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <dt style={{ color: "var(--ink-3)" }}>{t.product.leadTime}</dt>
                      <dd className="mono" style={{ margin: 0 }}>
                        {cheapest.leadTimeDaysMin}–{cheapest.leadTimeDaysMax} {t.product.businessDays}
                      </dd>
                    </div>
                  ) : null}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <dt style={{ color: "var(--ink-3)" }}>{t.product.stock}</dt>
                    <dd style={{ margin: 0, display: "flex", alignItems: "center", gap: 6 }}>
                      <StockDot stock={cheapest.stock} />
                      <span className="mono">{cheapest.stock}</span>
                    </dd>
                  </div>
                </dl>
              </>
            ) : null}

            <Link
              href={urls.product}
              style={{
                marginTop: "var(--space-4)",
                display: "block",
                background: "var(--accent)",
                color: "var(--ink-inverse)",
                padding: 12,
                textAlign: "center",
                fontSize: 15,
                fontWeight: 600,
                borderRadius: "var(--radius)",
              }}
            >
              {t.product.viewProduct}
            </Link>
          </div>
        </Panel>

        {siblings.length > 0 ? (
          <Panel style={{ marginTop: "var(--space-6)" }}>
            <div
              style={{
                fontSize: "var(--text-eyebrow)",
                fontWeight: 600,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--ink-2)",
              }}
            >
              {t.useCase.otherApplications}
            </div>
            <div style={{ marginTop: "var(--space-3)", display: "flex", flexDirection: "column", gap: "var(--space-3)", fontSize: 15, lineHeight: 1.45 }}>
              {siblings.map((sibling) => (
                <Link key={sibling.href} href={sibling.href}>
                  {sibling.title}
                </Link>
              ))}
            </div>
          </Panel>
        ) : null}
      </aside>
    </div>
  );
}
