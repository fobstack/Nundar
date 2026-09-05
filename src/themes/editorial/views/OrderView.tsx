import { OrderStatus } from "@/components/OrderStatus";
import type { OrderViewProps } from "@/themes/contract";

export function OrderView({ locale, t, orderNo }: OrderViewProps) {
  return (
    <div className="shell" style={{ paddingTop: "var(--space-12)", maxWidth: 700 }}>
      <h1 className="serif" style={{ margin: 0, fontSize: "var(--text-h1)", fontWeight: 600 }}>
        {t.page.orderThankYou}
      </h1>
      <OrderStatus orderNo={orderNo} locale={locale} />
    </div>
  );
}
