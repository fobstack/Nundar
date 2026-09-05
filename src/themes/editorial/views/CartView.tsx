import { CartPageView } from "@/components/CartView";
import type { CartViewProps } from "@/themes/contract";

export function CartView({ locale, currency, t }: CartViewProps) {
  return (
    <div className="shell" style={{ paddingTop: "var(--space-12)", maxWidth: 860 }}>
      <h1 className="serif" style={{ margin: 0, fontSize: "var(--text-h1)", fontWeight: 600 }}>
        {t.page.cart}
      </h1>
      <CartPageView locale={locale} currency={currency} />
    </div>
  );
}
