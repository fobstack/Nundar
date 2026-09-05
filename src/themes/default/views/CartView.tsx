import { CartPageView } from "@/components/CartView";
import type { CartViewProps } from "@/themes/contract";

const TITLE = { en: "Cart", de: "Warenkorb", fr: "Panier", es: "Carrito" } as const;

export function CartView({ locale, currency }: CartViewProps) {
  return (
    <div className="shell" style={{ paddingTop: "var(--space-12)", maxWidth: 880 }}>
      <h1 style={{ margin: 0, fontSize: "var(--text-h1)", fontWeight: 600, letterSpacing: "-0.02em" }}>
        {TITLE[locale]}
      </h1>
      <CartPageView locale={locale} currency={currency} />
    </div>
  );
}
