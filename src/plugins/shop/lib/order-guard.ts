/**
 * The condition every write that changes an order carries.
 *
 * An order is read, a decision is made from its status, and then something is
 * written. Between the reading and the writing another request may have moved
 * the order: a second delivery of the same payment, a second press of the
 * same button. So each statement of the write is conditional on the order
 * still being in the status that was read. D1 runs a batch as one
 * transaction; a batch that arrives second finds the condition false in
 * every statement, and writes nothing.
 *
 * The statement that changes the status goes last in its batch, because the
 * others test the status it changes.
 */

/** Binds the order id, then the status. */
export const ORDER_STILL_IN_STATUS =
  'EXISTS (SELECT 1 FROM p_shop_order WHERE id = ? AND status = ?)';

/** A condition for a WHERE clause, with the values it binds, in order. */
export interface SqlCondition {
  readonly sql: string;
  readonly binds: readonly string[];
}
