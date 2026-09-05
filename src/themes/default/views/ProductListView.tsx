import Link from "next/link";
import { formatMoney } from "@/lib/money";
import type { ProductListViewProps } from "@/themes/contract";
import { ProductPlaceholder } from "../components/primitives";

const LABEL = {
  en: { title: "Products", from: "from · per unit", request: "Price on request", empty: "No products yet." },
  de: { title: "Produkte", from: "ab · pro Stück", request: "Preis auf Anfrage", empty: "Noch keine Produkte." },
  fr: { title: "Produits", from: "à partir de · à l'unité", request: "Prix sur demande", empty: "Aucun produit." },
  es: { title: "Productos", from: "desde · por unidad", request: "Precio a consultar", empty: "Aún no hay productos." },
} as const;

export function ProductListView({ locale, products, urls }: ProductListViewProps) {
  const t = LABEL[locale];

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
        {t.title}
      </h1>

      {products.length === 0 ? (
        <p style={{ marginTop: "var(--space-6)", color: "var(--ink-3)" }}>{t.empty}</p>
      ) : (
        <div style={{ marginTop: "var(--space-8)", display: "flex", flexDirection: "column" }}>
          {/* 行式而非卡片式：工程采购横向比参数，卡片会把参数藏起来 */}
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
                    : t.request}
                </div>
                {product.fromPriceMinor !== null ? (
                  <div style={{ fontSize: "var(--text-eyebrow)", color: "var(--ink-3)", marginTop: 2 }}>
                    {t.from}
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
