import { OrderStatus } from "@/components/OrderStatus";
import type { OrderViewProps } from "@/themes/contract";

const TITLE = { en: "Thank you", de: "Vielen Dank", fr: "Merci", es: "Gracias" } as const;

export function OrderView({ locale, orderNo }: OrderViewProps) {
  return (
    <div className="shell" style={{ paddingTop: "var(--space-12)", maxWidth: 720 }}>
      <h1 style={{ margin: 0, fontSize: "var(--text-h1)", fontWeight: 600, letterSpacing: "-0.02em" }}>
        {TITLE[locale]}
      </h1>
      <OrderStatus orderNo={orderNo} locale={locale} />
    </div>
  );
}
