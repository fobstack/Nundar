import { CheckoutForm } from "@/components/CheckoutForm";
import type { CheckoutViewProps } from "@/themes/contract";

const TITLE = { en: "Checkout", de: "Kasse", fr: "Commande", es: "Pago" } as const;

export function CheckoutView({ locale, currency }: CheckoutViewProps) {
  return (
    <div className="shell" style={{ paddingTop: "var(--space-12)", maxWidth: 880 }}>
      <h1 style={{ margin: 0, fontSize: "var(--text-h1)", fontWeight: 600, letterSpacing: "-0.02em" }}>
        {TITLE[locale]}
      </h1>
      <CheckoutForm locale={locale} currency={currency} />
    </div>
  );
}
