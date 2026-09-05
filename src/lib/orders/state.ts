export const ORDER_STATUSES = [
  "pending",
  "paid",
  "shipped",
  "delivered",
  "cancelled",
  "refunded",
  "oversold",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * The order state machine.
 *
 * Only the transitions defined here are permitted; everything else is refused.
 * Letting status be rewritten freely is where commerce systems bury their
 * reconciliation and fulfilment incidents — shipping before payment clears, or
 * marking a refunded order as delivered.
 *
 * oversold: payment succeeded but the stock had already been sold. Such an
 * order can only be refunded or cancelled by hand. It must never ship.
 */
const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ["paid", "cancelled", "oversold"],
  paid: ["shipped", "refunded"],
  shipped: ["delivered", "refunded"],
  delivered: ["refunded"],
  oversold: ["refunded", "cancelled"],
  cancelled: [],
  refunded: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  const allowed = TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal order transition: ${from} → ${to}`);
  }
}
