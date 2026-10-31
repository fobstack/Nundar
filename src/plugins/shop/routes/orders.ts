/**
 * A buyer's way back to their orders: `GET orders` and `POST orders/link`
 * (`lib/order-lookup.ts`; design §21).
 *
 * `GET orders` asks for the address an order was placed with; opened with a
 * link's secret (`?t=…`), it lists that address's orders, each with its own
 * signed link. It reads and never writes. `POST orders/link` records the
 * request and, when the address has orders, emails it the link after it has
 * answered; it answers 303 to the page, saying the same whether or not there
 * were any, in the same time, and puts nothing a person typed in an
 * address.
 *
 * What the layout `shop/orders` receives as `plugin_page`:
 *
 *   mode          `ask` (the form) or `list` (a link opened it)
 *   notice        '' or `sent` (a link was asked for), `expired` (a link
 *                 that opens nothing any more)
 *   problem       '' or `invalid` (the address), `too_many` (the limits)
 *   action        where the form posts
 *   email_max, email_pattern   the server's rule for the address
 *   email         `list` only: the address the orders were placed with
 *   orders[]      `list` only: order_no, placed_on, status, total, path
 *   cart_path     the cart page
 *
 * A status is a word of the pack, `order_status_<status>`, as on an order's
 * page. The form's fields are `email` and `website`, which no person may see.
 */

import type {
  PluginPageResult,
  PluginRequestContext,
  RouteInput,
} from 'mallok/worker';
import { isCurrency } from '../lib/currency.js';
import { EMAIL_PATTERN_SOURCE, INQUIRY_LIMITS } from '../lib/inquiries.js';
import { formatMoney } from '../lib/money.js';
import {
  existingOrderLinkKey,
  orderLinkKey,
  orderToken,
} from '../lib/order-access.js';
import { orderLookupEmail } from '../lib/order-email.js';
import {
  lookupEmailOf,
  lookupFormSchema,
  newLookupToken,
  ordersOf,
  recordLookup,
} from '../lib/order-lookup.js';
import {
  CART_ROUTE,
  ORDER_ROUTE,
  ORDERS_LINK_ROUTE,
  ORDERS_ROUTE,
  shopPath,
  siteOriginOf,
} from '../lib/paths.js';

const NO_REFERRER = { 'referrer-policy': 'no-referrer' };

/** The page's address says what happened as one of these parameters. */
const SENT_PARAM = 'sent';
const PROBLEM_PARAM = 'lookup';
/** Why no link was sent. A theme has words for each. */
export const ORDER_LOOKUP_PROBLEMS = ['invalid', 'too_many'] as const;

function placedOn(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'long',
      timeZone: 'UTC',
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

/** `GET orders`: the form, or the list a link opens. */
export async function ordersPage(
  _input: RouteInput,
  ctx: PluginRequestContext,
): Promise<PluginPageResult> {
  const now = new Date();
  const { defaultLocale } = ctx.site;
  const base = {
    action: shopPath(ORDERS_LINK_ROUTE, ctx.locale, defaultLocale),
    cart_path: shopPath(CART_ROUTE, ctx.locale, defaultLocale),
    email_max: INQUIRY_LIMITS.email,
    email_pattern: EMAIL_PATTERN_SOURCE,
  };
  const token = ctx.url.searchParams.get('t');
  if (token !== null) {
    const email = await lookupEmailOf(ctx.db, token, now);
    if (email !== null) {
      const [orders, key] = await Promise.all([
        ordersOf(ctx.db, email),
        existingOrderLinkKey(ctx.db),
      ]);
      const listed = await Promise.all(
        orders.map(async (order) => ({
          order_no: order.orderNo,
          placed_on: placedOn(order.createdAt, ctx.locale),
          status: order.status,
          total: isCurrency(order.currency)
            ? formatMoney(order.totalMinor, order.currency, ctx.locale)
            : '',
          path:
            key === null
              ? ''
              : `${shopPath(`${ORDER_ROUTE}/${encodeURIComponent(order.orderNo)}`, ctx.locale, defaultLocale)}?k=${encodeURIComponent(await orderToken(key, order.id))}`,
        })),
      );
      return {
        headers: NO_REFERRER,
        view: {
          ...base,
          mode: 'list',
          notice: '',
          problem: '',
          email,
          orders: listed.filter((order) => order.path !== ''),
        },
      };
    }
  }
  const asked = ctx.url.searchParams.get(PROBLEM_PARAM);
  return {
    headers: NO_REFERRER,
    view: {
      ...base,
      mode: 'ask',
      notice:
        token !== null
          ? 'expired'
          : ctx.url.searchParams.get(SENT_PARAM) === '1'
            ? 'sent'
            : '',
      problem: ORDER_LOOKUP_PROBLEMS.find((kind) => kind === asked) ?? '',
    },
  };
}

/** Emails a link to a buyer's orders. It never throws: nobody awaits it. */
async function sendLookupLink(
  ctx: PluginRequestContext,
  input: {
    readonly to: string;
    readonly content: { subject: string; text: string; html: string };
    readonly now: Date;
  },
): Promise<void> {
  try {
    // The list the link opens signs each order's own link, and a GET makes
    // no key: an order placed other than through checkout may find none.
    await orderLinkKey(ctx.db, input.now);
    await ctx.sendEmail({ to: input.to, ...input.content });
  } catch (error) {
    // Not said on the page, which says the same whether or not there were
    // orders, and has been answered; the buyer can ask again.
    console.log(
      JSON.stringify({
        event: 'shop_order_lookup_failed',
        reason: error instanceof Error ? error.name : 'unknown',
      }),
    );
  }
}

/** `POST orders/link`: record the request, and email the link if there are orders. */
export async function ordersLink(
  input: RouteInput,
  ctx: PluginRequestContext,
): Promise<Response> {
  const now = new Date();
  const page = shopPath(ORDERS_ROUTE, ctx.locale, ctx.site.defaultLocale);
  const to = (query: Record<string, string>): Response =>
    new Response(null, {
      status: 303,
      headers: { location: `${page}?${new URLSearchParams(query).toString()}` },
    });

  const parsed = lookupFormSchema.safeParse(input.fields);
  if (!parsed.success) {
    return to({ [PROBLEM_PARAM]: 'invalid' });
  }
  // Answered as if all were well, and nothing is done.
  if (parsed.data.website !== '') {
    return to({ [SENT_PARAM]: '1' });
  }

  const token = newLookupToken();
  const recorded = await recordLookup(ctx.db, {
    token,
    email: parsed.data.email,
    ipHash: ctx.ipHash,
    now,
  });
  if (recorded.kind === 'too_many') {
    return to({ [PROBLEM_PARAM]: 'too_many' });
  }
  if (recorded.orders > 0) {
    // After the answer, never before it: the key and the email are two more
    // writes, and an answer that waited on them would take longer for an
    // address that has bought here than for one that has not.
    const link = `${siteOriginOf(ctx.site.domain, ctx.url)}${page}?t=${token}`;
    ctx.waitUntil(
      sendLookupLink(ctx, {
        to: parsed.data.email,
        content: orderLookupEmail({ locale: ctx.locale, link }),
        now,
      }),
    );
  }
  return to({ [SENT_PARAM]: '1' });
}
