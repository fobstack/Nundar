/**
 * The cart's two routes.
 *
 * `GET /_mallok/p/shop/cart` is the cart page. The plugin supplies what is in
 * the cart, priced now; the theme's `shop/cart` layout draws it, inside the
 * site's own header and footer.
 *
 * `POST /_mallok/p/shop/cart/update` is where every form that changes the
 * cart posts: the one on a product page that adds a size, and the cart page's
 * own, which set a quantity, remove a line or choose a currency. So adding to
 * the cart needs no client JavaScript. A change that goes through answers 303
 * to the cart page. One that is refused — fewer than the minimum order, more
 * than there is — answers with the cart page itself, saying what was refused,
 * so that the buyer is told in the place they can put it right.
 *
 * A quantity field's `min` and `step` enforce the minimum order in the
 * browser. This enforces it again, because a form can be bypassed.
 *
 * Either route is one visitor's own page: Mallok serves it uncached and
 * unindexed, whatever is returned here.
 */

import type {
  PluginPageResult,
  PluginRequestContext,
  RouteInput,
} from 'mallok/worker';
import { z } from 'zod';
import {
  isCartId,
  MAX_CART_LINES,
  MAX_LINE_QUANTITY,
  newCartId,
  readCartCurrencyStatement,
  readCartStatement,
  setCartCurrencyStatement,
  setLineStatements,
} from '../lib/cart.js';
import {
  quantityIssue,
  readCartFacts,
  type VariantRow,
} from '../lib/cart-pricing.js';
import { cartView } from '../lib/cart-view.js';
import { cartCookieHeader, readCartCookie } from '../lib/cookie.js';
import {
  type Currency,
  defaultCurrencyForLocale,
  isCurrency,
} from '../lib/currency.js';
import { CART_ROUTE, CART_UPDATE_ROUTE, shopPath } from '../lib/paths.js';

const updateSchema = z.object({
  action: z.enum(['add', 'set', 'remove', 'currency']).default('add'),
  variant: z.string().max(100).default(''),
  quantity: z
    .string()
    .regex(/^\d{1,6}$/)
    .default('1'),
  currency: z.string().max(3).default(''),
  /** Where to send the buyer afterwards: a path on this site. */
  return: z.string().max(500).default(''),
});

interface VariantLookup extends VariantRow {
  product_published: number;
}

/**
 * What was refused, for the page to say. `kind` is the reason; the rest is
 * what the reason is about. A theme has its own words for each kind.
 */
interface Refusal {
  readonly kind:
    | 'unavailable'
    | 'below_moq'
    | 'insufficient_stock'
    | 'quantity_too_large'
    | 'cart_full';
  /** The SKU the buyer asked for; '' when the shop does not know it. */
  readonly sku: string;
  readonly requested: number;
  readonly moq: number | null;
  readonly available: number | null;
  readonly max: number | null;
}

/**
 * Accepts only a path on this site. Anything else — another origin, a
 * protocol-relative `//host`, a backslash trick — falls back, so the
 * redirect cannot be used to send a buyer somewhere else.
 */
function safeReturnPath(
  value: string,
  origin: string,
  fallback: string,
): string {
  if (
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\')
  ) {
    return fallback;
  }
  try {
    const url = new URL(value, origin);
    return url.origin === origin ? `${url.pathname}${url.search}` : fallback;
  } catch {
    return fallback;
  }
}

function paths(ctx: PluginRequestContext): { cart: string; update: string } {
  const { defaultLocale } = ctx.site;
  return {
    cart: shopPath(CART_ROUTE, ctx.locale, defaultLocale),
    update: shopPath(CART_UPDATE_ROUTE, ctx.locale, defaultLocale),
  };
}

/**
 * The cart page for a cart id, as it stands now.
 *
 * Two round trips: the cart's lines and its currency, then everything those
 * lines depend on. An unknown, expired or absent cart is an empty one.
 */
async function showCart(
  ctx: PluginRequestContext,
  cartId: string | null,
  now: Date,
  extra: {
    readonly status?: number;
    readonly refused?: Refusal;
    readonly headers?: HeadersInit;
  } = {},
): Promise<PluginPageResult> {
  const known = cartId !== null && isCartId(cartId) ? cartId : '';
  const [linesResult, currencyResult] = await ctx.db.batch<
    { variant_id: string; quantity: number } | { currency: string | null }
  >([
    readCartStatement(ctx.db, known, now),
    readCartCurrencyStatement(ctx.db, known, now),
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

  const facts = await readCartFacts(ctx.db, {
    lines,
    locale: ctx.locale,
    defaultLocale: ctx.site.defaultLocale,
    currency,
  });
  const { cart, update } = paths(ctx);
  return {
    view: {
      ...cartView(facts, ctx.locale),
      action: update,
      cart_path: cart,
      problem: extra.refused ?? null,
    },
    ...(extra.status === undefined ? {} : { status: extra.status }),
    ...(extra.headers === undefined ? {} : { headers: extra.headers }),
  };
}

/** `GET cart`: the cart page. It reads and never writes. */
export async function cartPage(
  _input: RouteInput,
  ctx: PluginRequestContext,
): Promise<PluginPageResult> {
  return showCart(ctx, readCartCookie(ctx.request), new Date());
}

/** `POST cart/update`: add a line, set its quantity, remove it, or choose a currency. */
export async function cartUpdate(
  input: RouteInput,
  ctx: PluginRequestContext,
): Promise<Response | PluginPageResult> {
  const parsed = updateSchema.safeParse(input.fields);
  if (!parsed.success) {
    // Not something a form on this site sends: no page to show for it.
    return new Response('Bad request', { status: 400 });
  }
  const form = parsed.data;
  const now = new Date();
  const { cart } = paths(ctx);
  const existingCartId = readCartCookie(ctx.request);
  const secure = ctx.url.protocol === 'https:';

  const redirect = (cartId: string | null): Response => {
    const headers = new Headers({
      location: safeReturnPath(form.return, ctx.url.origin, cart),
    });
    if (cartId !== null) {
      headers.set('set-cookie', cartCookieHeader(cartId, secure));
    }
    return new Response(null, { status: 303, headers });
  };

  if (form.action === 'currency') {
    if (!isCurrency(form.currency)) {
      return new Response('Bad request', { status: 400 });
    }
    // Nothing to do for a visitor without a cart: an empty cart has no
    // prices to show in any currency, and is not created for the asking.
    if (existingCartId !== null) {
      await setCartCurrencyStatement(ctx.db, {
        cartId: existingCartId,
        currency: form.currency,
        now,
      }).run();
    }
    return redirect(existingCartId);
  }

  if (form.variant === '') {
    return new Response('Bad request', { status: 400 });
  }
  // A form that names no currency leaves the cart's own as it is, and a new
  // cart starts in its language's.
  const currency = isCurrency(form.currency)
    ? form.currency
    : existingCartId === null
      ? defaultCurrencyForLocale(ctx.locale)
      : null;
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
    readCartStatement(ctx.db, cartId, now),
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

  /** The cart as it is, unchanged, with what was refused. */
  const refuse = (
    status: number,
    refused: Omit<Refusal, 'sku' | 'requested'>,
  ): Promise<PluginPageResult> =>
    showCart(ctx, existingCartId, now, {
      status,
      refused: { sku: variant?.sku ?? '', requested: target, ...refused },
    });
  const nothing = { moq: null, available: null, max: null };

  if (target > 0) {
    if (variant === undefined || variant.product_published !== 1) {
      return refuse(409, { kind: 'unavailable', ...nothing });
    }
    if (target > MAX_LINE_QUANTITY) {
      return refuse(422, {
        kind: 'quantity_too_large',
        ...nothing,
        max: MAX_LINE_QUANTITY,
      });
    }
    const issue = quantityIssue(variant, target);
    if (issue !== null) {
      if (issue.kind === 'below_moq') {
        return refuse(422, { kind: 'below_moq', ...nothing, moq: issue.moq });
      }
      if (issue.kind === 'insufficient_stock') {
        return refuse(422, {
          kind: 'insufficient_stock',
          ...nothing,
          available: issue.available,
        });
      }
      return refuse(409, { kind: 'unavailable', ...nothing });
    }
    if (current === 0 && lines.length >= MAX_CART_LINES) {
      return refuse(422, {
        kind: 'cart_full',
        ...nothing,
        max: MAX_CART_LINES,
      });
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
        locale: ctx.locale,
        now,
      }),
    );
  }

  return redirect(target > 0 || existingCartId !== null ? cartId : null);
}
