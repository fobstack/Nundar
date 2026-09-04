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
 * 订单状态机。
 *
 * 只允许这里定义的流转，其余一律拒绝——状态随意改写是电商系统最容易埋下
 * 对账与履约事故的地方（例如未付款就发货、已退款又被标记为已送达）。
 *
 * oversold：支付成功但库存已被买走，只能退款或人工取消，绝不能继续发货。
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
