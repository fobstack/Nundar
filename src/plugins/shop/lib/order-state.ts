/**
 * The order state machine.
 *
 * Only the transitions defined here are permitted; everything else is refused.
 * Letting a status be rewritten freely is where commerce systems bury their
 * reconciliation and fulfilment incidents — shipping before payment clears, or
 * marking a refunded order as delivered.
 *
 * `oversold` means payment succeeded but the stock had already been sold. Such
 * an order can only be refunded or cancelled by hand. It must never ship.
 */

export const ORDER_STATUSES = [
  'pending',
  'paid',
  'shipped',
  'delivered',
  'cancelled',
  'refunded',
  'oversold',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

const TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  pending: ['paid', 'cancelled', 'oversold'],
  paid: ['shipped', 'refunded'],
  shipped: ['delivered', 'refunded'],
  delivered: ['refunded'],
  oversold: ['refunded', 'cancelled'],
  cancelled: [],
  refunded: [],
};

export function isOrderStatus(value: string): value is OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(value);
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  // A status read back from the database is only a string. One this table
  // does not know must refuse the transition, not throw.
  const allowed = TRANSITIONS[from] as readonly OrderStatus[] | undefined;
  return allowed?.includes(to) ?? false;
}

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal order transition: ${from} → ${to}`);
  }
}
