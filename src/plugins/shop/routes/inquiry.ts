/**
 * `POST /_mallok/p/shop/cart/inquiry`: the cart, sent as a request for a
 * quote.
 *
 * It is the cart page's own form, and like the cart's other form it never
 * answers with a page: every answer is a 303 to the cart page, which says
 * what happened — the number of the inquiry, or why none was made. What the
 * address carries is a kind and, for a field that was wrong, its name, and
 * nothing a person typed: an address ends up in histories and logs.
 *
 * So a form the server refuses comes back empty. The fields carry the
 * server's own rules as `required`, `maxlength` and `pattern`, and the
 * server takes what a browser lets through — a tab in a name, a line break
 * counted once — so that a person using a browser does not meet that for
 * what they typed. They can for what happened meanwhile: the cart changed,
 * or the limit was reached.
 *
 * The form has no challenge in front of it. A theme may load no script from
 * another host and Mallok runs no hook on a plugin's page, so Turnstile has
 * nowhere to be drawn. What stands in its place: Mallok's cross-site check
 * and its strict rate limit, a field no person sees, an exact limit per
 * visitor counted in the table, and that a cart must exist — an inquiry is a
 * second request, with the cookie from the first.
 *
 * What is sent is the cart exactly as it is at the write: a cart that
 * changed between being read here and being written is not sent, and the
 * buyer is asked to look at it again.
 */

import type { PluginRequestContext, RouteInput } from 'mallok/worker';
import { readCartCurrencyStatement, readCartStatement } from '../lib/cart.js';
import { readCartFacts } from '../lib/cart-pricing.js';
import { readCartCookie } from '../lib/cookie.js';
import {
  type Currency,
  defaultCurrencyForLocale,
  isCurrency,
} from '../lib/currency.js';
import {
  atVisitorLimit,
  firstInvalidField,
  inquiryFormSchema,
  inquiryLinesOf,
  inquiryStatements,
  newInquiryNo,
  visitorCountStatement,
  whyNotStored,
} from '../lib/inquiries.js';
import {
  INQUIRY_EMAILS_JOB,
  inquirySettings,
  owesEmail,
} from '../lib/inquiry-jobs.js';
import { CART_ROUTE, shopPath } from '../lib/paths.js';

/** Why a cart was not sent. A theme has words for each. */
export const INQUIRY_REFUSALS = [
  'invalid',
  'empty',
  'cart_problem',
  'cart_changed',
  'too_many',
] as const;

export type InquiryRefusalKind = (typeof INQUIRY_REFUSALS)[number];

/** The cart page's address carries the outcome as these parameters. */
export const INQUIRY_PARAM = 'inquiry';
export const INQUIRY_FIELD_PARAM = 'field';
export const SENT_PARAM = 'sent';

export async function cartInquiry(
  input: RouteInput,
  ctx: PluginRequestContext,
): Promise<Response> {
  const now = new Date();
  const cart = shopPath(CART_ROUTE, ctx.locale, ctx.site.defaultLocale);
  const to = (query: Record<string, string>): Response => {
    const search = new URLSearchParams(query).toString();
    return new Response(null, {
      status: 303,
      headers: { location: search === '' ? cart : `${cart}?${search}` },
    });
  };
  const refuse = (kind: InquiryRefusalKind, field?: string): Response =>
    to({
      [INQUIRY_PARAM]: kind,
      ...(field === undefined ? {} : { [INQUIRY_FIELD_PARAM]: field }),
    });

  const parsed = inquiryFormSchema.safeParse(input.fields);
  if (!parsed.success) {
    return refuse('invalid', firstInvalidField(parsed.error) ?? undefined);
  }
  const form = parsed.data;

  // Whatever filled in the field no person sees is answered as if all were
  // well, and nothing is stored: it learns nothing to try differently.
  if (form.website !== '') {
    return to({});
  }

  const cartId = readCartCookie(ctx.request);
  if (cartId === null) {
    return refuse('empty');
  }

  const [linesResult, currencyResult, countResult] = await ctx.db.batch<
    | { variant_id: string; quantity: number }
    | { currency: string | null }
    | { n: number }
  >([
    readCartStatement(ctx.db, cartId, now),
    readCartCurrencyStatement(ctx.db, cartId, now),
    visitorCountStatement(ctx.db, ctx.ipHash, now),
  ]);
  const lines = (
    (linesResult?.results ?? []) as { variant_id: string; quantity: number }[]
  ).map((row) => ({ variantId: row.variant_id, quantity: row.quantity }));
  const chosen = (
    (currencyResult?.results ?? []) as { currency: string | null }[]
  )[0]?.currency;
  const currency: Currency =
    typeof chosen === 'string' && isCurrency(chosen)
      ? chosen
      : defaultCurrencyForLocale(ctx.locale);

  /** An inquiry that was not stored: say which it was, from the data. */
  const notStored = async (
    sending: readonly { variantId: string; quantity: number }[],
  ): Promise<Response> => {
    const why = await whyNotStored(ctx.db, {
      cartId,
      ipHash: ctx.ipHash,
      now,
      lines: sending,
    });
    return why.kind === 'sent'
      ? to({ [SENT_PARAM]: why.inquiryNo })
      : refuse(why.kind);
  };

  // Nothing in the cart: an empty cart, or this same form arriving a second
  // time after the first emptied it.
  if (lines.length === 0) {
    return notStored([]);
  }

  const facts = await readCartFacts(ctx.db, {
    lines,
    locale: ctx.locale,
    defaultLocale: ctx.site.defaultLocale,
    currency,
    now,
  });
  const sendable = inquiryLinesOf(facts);
  if (sendable === null) {
    return refuse('cart_problem');
  }

  // The limit is asked again inside the write, which is what makes it exact.
  // It is asked here first so that a visitor over it queues no job: Mallok
  // runs five jobs a minute for the whole site, and a job that finds nothing
  // to send still takes a turn.
  const alreadySent =
    ((countResult?.results ?? [])[0] as { n: number } | undefined)?.n ?? 0;
  if (atVisitorLimit(alreadySent)) {
    return refuse('too_many');
  }

  const id = crypto.randomUUID();
  const inquiryNo = newInquiryNo(now);
  const statements = inquiryStatements(ctx.db, {
    id,
    inquiryNo,
    cartId,
    form,
    locale: ctx.locale,
    currency: facts.currency,
    country: ctx.country ?? '',
    ipHash: ctx.ipHash,
    lines: sendable,
    now,
  });
  // The emails are owed in the same batch that stores the inquiry. The job
  // is queued whether or not the conditional write stores one — Mallok
  // builds its statement and it takes no condition — and finds nothing to
  // send when it did not.
  if (owesEmail(inquirySettings(ctx.settings))) {
    statements.push(
      ctx.enqueueStatement(INQUIRY_EMAILS_JOB, { inquiryId: id }),
    );
  }
  const [stored] = await ctx.db.batch(statements);
  if ((stored?.meta.changes ?? 0) === 0) {
    return notStored(sendable);
  }

  // The address is all that is logged of it: a kind and a count, no person.
  console.log(
    JSON.stringify({ event: 'shop_inquiry', lines: sendable.length }),
  );
  return to({ [SENT_PARAM]: inquiryNo });
}
