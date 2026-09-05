import Link from "next/link";
import { formatMoney } from "@/lib/money";
import type { ProductListViewProps } from "@/themes/contract";
import { ProductPlaceholder } from "../components/primitives";

export function ProductListView({ locale, products, t, urls }: ProductListViewProps) {
  return (
    <div className="shell" style={{ paddingTop: "var(--space-12)" }}>
      <h1
        style={{
          margin: 0,
          fontSize: "var(--text-h1)",
          fontWeight: 600,
          letterSpacing: "-0.02em",
        }}
      >
        {t.nav.products}
      </h1>

      {products.length === 0 ? (
        <p style={{ marginTop: "var(--space-6)", color: "var(--ink-3)" }}>{t.list.empty}</p>
      ) : (
        <div style={{ marginTop: "var(--space-8)", display: "flex", flexDirection: "column" }}>
          {/* Rows, not cards: engineering buyers compare specifications across
              items, and cards hide exactly those specifications */}
          {products.map((product) => (
            <article
              key={product.id}
              style={{
                display: "flex",
                gap: "var(--space-6)",
                padding: "var(--space-6) 0",
                borderBottom: "1px solid var(--line)",
                alignItems: "flex-start",
              }}
            >
              <div
                style={{
                  width: 132,
                  height: 132,
                  border: "1px solid var(--line)",
                  background: "var(--surface)",
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <ProductPlaceholder size={100} />
              </div>

              <div style={{ flexGrow: 1, minWidth: 0 }}>
                <h2 style={{ margin: 0, fontSize: "var(--text-lg)", fontWeight: 600, lineHeight: 1.35 }}>
                  <Link href={urls.product(product.slug)}>{product.name}</Link>
                </h2>
                {product.summary ? (
                  <p
                    style={{
                      margin: "6px 0 0",
                      fontSize: "var(--text-sm)",
                      lineHeight: 1.6,
                      color: "var(--ink-2)",
                      maxWidth: "60ch",
                    }}
                  >
                    {product.summary}
                  </p>
                ) : null}
              </div>

              <div style={{ width: 168, flexShrink: 0, textAlign: "right" }}>
                <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.01em" }}>
                  {product.fromPriceMinor !== null && product.priceCurrency
                    ? formatMoney(product.fromPriceMinor, product.priceCurrency, locale)
                    : t.product.priceOnRequest}
                </div>
                {product.fromPriceMinor !== null ? (
                  <div style={{ fontSize: "var(--text-eyebrow)", color: "var(--ink-3)", marginTop: 2 }}>
                    {`${t.product.from} · ${t.product.perUnit}`}
                  </div>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
