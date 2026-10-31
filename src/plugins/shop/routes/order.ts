/**
 * `GET /_mallok/p/shop/order/:orderNo?k=…`: one order's page, for its buyer.
 *
 * Where Stripe sends the buyer back after paying, and where every email
 * points. It opens only with the secret the link carries (`order-access.ts`);
 * a wrong one, a missing one and an order that does not exist all answer the
 * same 404, so a guess learns nothing. It reads and never writes.
 *
 * What the layout `shop/order` receives as `plugin_page`:
 *
 *   found          false: there is no such order, or the link is not its own.
 *                  Nothing else is set
 *   order_no       the order's number
 *   status         `pending`, `paid`, `shipped`, `delivered`, `cancelled`,
 *                  `refunded`, `oversold`. A theme words each: a pending order
 *                  is one whose payment is still being confirmed, and an
 *                  oversold one is being looked into
 *   placed_on      the date it was placed, in the page's language
 *   lines[]        sku, name, quantity, unit_price, line_total
 *   subtotal, shipping, tax, total    formatted; `tax` is '' when none was
 *                  charged
 *   tax_mode       as at checkout: `none` or `stripe`
 *   zone           the shipping zone's name
 *   address[]      the address it ships to, a line each
 *   company, email, tax_id
 *   carrier, tracking_no              '' until it ships
 *   lead_time_days the business days within which it leaves, or null
 *   cart_path      the cart page
 */

import type {
  PluginPageResult,
  PluginRequestContext,
  RouteInput,
} from 'mallok/worker';
import { formatMoney } from '../lib/money.js';
import { existingOrderLinkKey, tokenOpens } from '../lib/order-access.js';
import { getOrder } from '../lib/orders.js';
import { CART_ROUTE, shopPath } from '../lib/paths.js';
import { countryName } from '../lib/shipping.js';

/** What an order number looks like: a prefix, a date, eight characters. */
const ORDER_NO_SHAPE = /^[A-Z0-9]{1,6}-\d{6}-[0-9A-Z]{8}$/;

export async function orderPage(
  input: RouteInput,
  ctx: PluginRequestContext,
): Promise<PluginPageResult> {
  const notFound: PluginPageResult = { status: 404, view: { found: false } };
  const orderNo = input.params.orderNo ?? '';
  const token = ctx.url.searchParams.get('k') ?? '';
  if (!ORDER_NO_SHAPE.test(orderNo) || token === '') {
    return notFound;
  }
  const [order, key] = await Promise.all([
    getOrder(ctx.db, { orderNo }),
    existingOrderLinkKey(ctx.db),
  ]);
  if (
    order === null ||
    key === null ||
    !(await tokenOpens(key, order.id, token))
  ) {
    return notFound;
  }

  const money = (minor: number) =>
    formatMoney(minor, order.currency, ctx.locale);
  const address = order.shippingAddress;
  const cityLine = [address.postalCode, address.city]
    .filter((part) => part !== undefined && part !== '')
    .join(' ');
  let placedOn = order.createdAt.slice(0, 10);
  try {
    placedOn = new Intl.DateTimeFormat(ctx.locale, {
      dateStyle: 'long',
      timeZone: 'UTC',
    }).format(new Date(order.createdAt));
  } catch {
    // A locale the runtime cannot format in keeps the ISO date.
  }

  return {
    title: order.orderNo,
    view: {
      found: true,
      order_no: order.orderNo,
      status: order.status,
      placed_on: placedOn,
      lines: order.lines.map((line) => ({
        sku: line.sku,
        name: line.name,
        quantity: line.quantity,
        unit_price: money(line.unitPriceMinor),
        line_total: money(line.unitPriceMinor * line.quantity),
      })),
      subtotal: money(order.subtotalMinor),
      shipping: money(order.shippingMinor),
      tax: order.taxMinor > 0 ? money(order.taxMinor) : '',
      total: money(order.totalMinor),
      tax_mode: order.taxMode,
      zone: order.shippingZone,
      address: [
        address.recipient,
        address.line1,
        address.line2,
        cityLine,
        address.state,
        address.country === undefined || address.country === ''
          ? undefined
          : countryName(address.country, ctx.locale),
      ].filter((line): line is string => line !== undefined && line !== ''),
      company: order.company,
      email: order.email,
      tax_id: order.taxId,
      carrier: order.carrier ?? '',
      tracking_no: order.trackingNo ?? '',
      lead_time_days: order.leadTimeDaysMax,
      cart_path: shopPath(CART_ROUTE, ctx.locale, ctx.site.defaultLocale),
    },
  };
}
