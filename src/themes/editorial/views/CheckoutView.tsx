import { CheckoutForm } from "@/components/CheckoutForm";
import type { CheckoutViewProps } from "@/themes/contract";

export function CheckoutView({ locale, currency, t }: CheckoutViewProps) {
  return (
    <div className="shell" style={{ paddingTop: "var(--space-12)", maxWidth: 860 }}>
      <h1 className="serif" style={{ margin: 0, fontSize: "var(--text-h1)", fontWeight: 600 }}>
        {t.page.checkout}
      </h1>
      <CheckoutForm locale={locale} currency={currency} />
    </div>
  );
}
