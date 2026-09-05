import Link from "next/link";
import { formatMoney } from "@/lib/money";
import type { ProductListViewProps } from "@/themes/contract";
import { Card, ProductPlaceholder } from "../components/primitives";

export function ProductListView({ locale, products, t, urls }: ProductListViewProps) {
  return (
    <div className="shell" style={{ paddingTop: "var(--space-12)" }}>
      <h1
        className="serif"
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
        // Cards, where the default theme uses comparison rows. Same data, a
        // different reading order — which is the whole point of a second theme.
        <div
          style={{
            marginTop: "var(--space-8)",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
            gap: "var(--space-6)",
          }}
        >
          {products.map((product) => (
            <Link key={product.id} href={urls.product(product.slug)}>
              <Card padded={false} style={{ height: "100%", overflow: "hidden" }}>
                <div
                  style={{
                    background: "var(--surface-sunken)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "var(--space-8)",
                  }}
                >
                  <ProductPlaceholder size={160} />
                </div>
                <div style={{ padding: "var(--space-6)" }}>
                  <h2
                    className="serif"
                    style={{
                      margin: 0,
                      fontSize: "var(--text-h3)",
                      fontWeight: 600,
                      lineHeight: 1.3,
                    }}
                  >
                    {product.name}
                  </h2>
                  {product.summary ? (
                    <p
                      style={{
                        margin: "var(--space-3) 0 0",
                        fontSize: "var(--text-sm)",
                        lineHeight: 1.6,
                        color: "var(--ink-2)",
                      }}
                    >
                      {product.summary}
                    </p>
                  ) : null}
                  <div
                    style={{
                      marginTop: "var(--space-6)",
                      display: "flex",
                      alignItems: "baseline",
                      gap: "var(--space-2)",
                    }}
                  >
                    <span className="serif" style={{ fontSize: 24, fontWeight: 600 }}>
                      {product.fromPriceMinor !== null && product.priceCurrency
                        ? formatMoney(product.fromPriceMinor, product.priceCurrency, locale)
                        : t.product.priceOnRequest}
                    </span>
                    {product.fromPriceMinor !== null ? (
                      <span style={{ fontSize: "var(--text-xs)", color: "var(--ink-3)" }}>
                        {`${t.product.from} · ${t.product.perUnit}`}
                      </span>
                    ) : null}
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
