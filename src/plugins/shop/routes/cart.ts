/**
 * `POST /_mallok/p/shop/cart` — add a line, set its quantity, or remove it.
 *
 * A plain HTML form on a product page posts here, so adding to the cart needs
 * no client JavaScript. The quantity field's `min` and `step` enforce the
 * minimum order quantity in the browser; this handler enforces it again,
 * because a form can be bypassed.
 */

import type { PluginRequestContext, RouteInput } from 'mallok/worker';
import { z } from 'zod';
import {
  isCartId,
  MAX_CART_LINES,
  MAX_LINE_QUANTITY,
  newCartId,
  readCartStatement,
  setLineStatements,
} from '../lib/cart.js';
import { quantityIssue, type VariantRow } from '../lib/cart-pricing.js';
import { cartCookieHeader, readCartCookie } from '../lib/cookie.js';
import { defaultCurrencyForLocale, isCurrency } from '../lib/currency.js';

const cartSchema = z.object({
  action: z.enum(['add', 'set', 'remove']).default('add'),
  variant: z.string().min(1).max(100),
  quantity: z
    .string()
    .regex(/^\d{1,6}$/)
    .default('1'),
  currency: z.string().max(3).default(''),
  locale: z.string().max(20).default(''),
  /** Where to send the buyer afterwards: a path on this site. */
  return: z.string().max(500).default('/'),
});

interface VariantLookup extends VariantRow {
  product_published: number;
}

function problem(
  status: number,
  body: Readonly<Record<string, unknown>>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/**
 * Accepts only a path on this site. Anything else — another origin, a
 * protocol-relative `//host`, a backslash trick — falls back to the home page,
 * so the redirect cannot be used to send a buyer somewhere else.
 */
function safeReturnPath(value: string, origin: string): string {
  if (
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\')
  ) {
    return '/';
  }
  try {
    const url = new URL(value, origin);
    return url.origin === origin ? `${url.pathname}${url.search}` : '/';
  } catch {
    return '/';
  }
}

export async function cart(
  input: RouteInput,
  ctx: PluginRequestContext,
): Promise<Response> {
  const parsed = cartSchema.safeParse(input.fields);
  if (!parsed.success) {
    return problem(400, { error: 'invalid_request' });
  }
  const form = parsed.data;
  const now = new Date();

  const locale = ctx.site.locales.includes(form.locale)
    ? form.locale
    : ctx.site.defaultLocale;
  const currency = isCurrency(form.currency)
    ? form.currency
    : defaultCurrencyForLocale(locale);

  const existingCartId = readCartCookie(ctx.request);
  const cartId = existingCartId ?? newCartId();

  // One batch: the variant, whether its product is published, and the cart
  // as it stands.
  const [variantResult, linesResult] = await ctx.db.batch<
    VariantLookup | { variant_id: string; quantity: number }
  >([
    ctx.db
      .prepare(
        `SELECT v.id, v.product_group, v.sku, v.moq, v.stock, v.stock_policy,
                v.status,
                EXISTS (
                  SELECT 1 FROM content AS c
                  WHERE c.translation_group = v.product_group
                    AND c.status = 'published'
                ) AS product_published
         FROM p_shop_variant AS v WHERE v.id = ?`,
      )
      .bind(form.variant),
    readCartStatement(ctx.db, isCartId(cartId) ? cartId : '', now),
  ]);

  const variant = (variantResult?.results ?? [])[0] as
    | VariantLookup
    | undefined;
  const lines = (linesResult?.results ?? []) as {
    variant_id: string;
    quantity: number;
  }[];
  const current =
    lines.find((line) => line.variant_id === form.variant)?.quantity ?? 0;

  const requested = Number(form.quantity);
  const target =
    form.action === 'remove'
      ? 0
      : form.action === 'set'
        ? requested
        : current + requested;

  if (target > 0) {
    if (variant === undefined || variant.product_published !== 1) {
      return problem(409, { error: 'unavailable', variant: form.variant });
    }
    if (target > MAX_LINE_QUANTITY) {
      return problem(422, {
        error: 'quantity_too_large',
        max: MAX_LINE_QUANTITY,
      });
    }
    const issue = quantityIssue(variant, target);
    if (issue !== null) {
      const { kind, ...detail } = issue;
      return problem(kind === 'unavailable' ? 409 : 422, {
        error: kind,
        ...detail,
      });
    }
    if (current === 0 && lines.length >= MAX_CART_LINES) {
      return problem(422, { error: 'cart_full', max: MAX_CART_LINES });
    }
  }

  // Removing a line that is not there, from a cart that does not exist, has
  // nothing to write — and must not create a cart as a side effect.
  if (target > 0 || current > 0) {
    await ctx.db.batch(
      setLineStatements(ctx.db, {
        cartId,
        variantId: form.variant,
        quantity: target,
        currency,
        locale,
        now,
      }),
    );
  }

  const headers = new Headers({
    location: safeReturnPath(form.return, ctx.url.origin),
  });
  if (target > 0 || existingCartId !== null) {
    headers.set(
      'set-cookie',
      cartCookieHeader(cartId, ctx.url.protocol === 'https:'),
    );
  }
  return new Response(null, { status: 303, headers });
}
