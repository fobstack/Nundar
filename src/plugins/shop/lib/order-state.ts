/**
 * The order state machine.
 *
 * Only the transitions defined here are permitted; everything else is refused.
 * Letting a status be rewritten freely is where commerce systems bury their
 * reconciliation and fulfilment incidents — shipping before payment clears, or
 * marking a refunded order as delivered.
 *
 * `oversold` means payment succeeded but the stock had already been sold. It
 * must never ship as it is. A person either refunds it, or restocks and
 * fulfils it, which takes the stock then and makes it `paid`. It is never
 * just cancelled: that would leave a payment taken and nobody owing a refund
 * of it (design §20).
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

/**
 * The statuses an order reaches only through a payment. `cancelled` is not
 * one: only a pending order is cancelled, so a cancelled order was never
 * paid for, and its address was never shown to be its buyer's.
 */
export const PAID_FOR_STATUSES: readonly OrderStatus[] = [
  'paid',
  'oversold',
  'shipped',
  'delivered',
  'refunded',
];

const TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  pending: ['paid', 'cancelled', 'oversold'],
  paid: ['shipped', 'refunded'],
  shipped: ['delivered', 'refunded'],
  delivered: ['refunded'],
  oversold: ['refunded', 'paid'],
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
