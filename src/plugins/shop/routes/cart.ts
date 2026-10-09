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
 * the cart needs no client JavaScript. It never answers with a page: every
 * answer is a 303 to the cart page. A change that is refused — fewer than the
 * minimum order, more than there is — goes there too, with what was refused
 * in the address, and the cart page says it above the cart as it still is.
 * So the buyer is told in the place they can put it right, a reload does not
 * post the form again, and the page they land on is one whose language can
 * be switched: a page rendered by the POST itself would be listed, in every
 * language, at an address that only takes a POST.
 *
 * A quantity field's `min`, `step` and `max` enforce the minimum order and
 * the most a line may hold in the browser. This enforces both again, because
 * a form can be bypassed.
 *
 * The cart page is one visitor's own: Mallok serves it uncached and
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
import {
  INQUIRY_FIELDS,
  inquiryLinesOf,
  isInquiryNo,
  sentInquiryStatement,
} from '../lib/inquiries.js';
import {
  CART_INQUIRY_ROUTE,
  CART_ROUTE,
  CART_UPDATE_ROUTE,
  shopPath,
} from '../lib/paths.js';
import {
  INQUIRY_FIELD_PARAM,
  INQUIRY_PARAM,
  INQUIRY_REFUSALS,
  SENT_PARAM,
} from './inquiry.js';

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

/** Why a change to the cart was not made. A theme has words for each. */
const REFUSALS = [
  'unavailable',
  'below_moq',
  'insufficient_stock',
  'quantity_too_large',
  'cart_full',
] as const;

type RefusalKind = (typeof REFUSALS)[number];

/** The cart page's address carries a refusal as these two parameters. */
const REFUSED_PARAM = 'refused';
const VARIANT_PARAM = 'variant';

/**
 * What was refused, for the page to say: the reason, and the figure it is
 * about. None of it is taken from the address — only which reason and which
 * variant are, and the rest is read from the database, so that a link
 * somebody made up can put no words of its own on the page.
 */
interface Refusal {
  readonly kind: RefusalKind;
  /** The SKU the buyer asked for; '' when the shop does not know it. */
  readonly sku: string;
  readonly moq: number | null;
  readonly available: number | null;
  readonly max: number | null;
}

interface VariantLookup extends VariantRow {
  product_published: number;
}

/**
 * Accepts only a path on this site. Anything else falls back, so the
 * redirect cannot be used to send a buyer somewhere else.
 *
 * It is the path as the browser will read it that is judged, not the text
 * that was sent: `/.//host` begins with one slash, and is `//host` — another
 * site — once its dot segment is resolved. A backslash is a slash by then
 * too, so `/\host` and `/./\host` are caught by the same two questions.
 */
function safeReturnPath(
  value: string,
  origin: string,
  fallback: string,
): string {
  if (!value.startsWith('/')) {
    return fallback;
  }
  try {
    const url = new URL(value, origin);
    const path = `${url.pathname}${url.search}`;
    return url.origin === origin && !path.startsWith('//') ? path : fallback;
  } catch {
    return fallback;
  }
}

function paths(ctx: PluginRequestContext): {
  cart: string;
  update: string;
  inquiry: string;
} {
  const { defaultLocale } = ctx.site;
  return {
    cart: shopPath(CART_ROUTE, ctx.locale, defaultLocale),
    update: shopPath(CART_UPDATE_ROUTE, ctx.locale, defaultLocale),
    inquiry: shopPath(CART_INQUIRY_ROUTE, ctx.locale, defaultLocale),
  };
}

/**
 * The statement both routes find a variant by. Its product counts when a
 * visitor can see it: published, and not scheduled for later.
 */
function variantStatement(
  db: D1Database,
  variantId: string,
  now: Date,
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT v.id, v.product_group, v.sku, v.moq, v.stock, v.stock_policy,
              v.status,
              EXISTS (
                SELECT 1 FROM content AS c
                WHERE c.translation_group = v.product_group
                  AND c.status = 'published' AND c.published_at <= ?
              ) AS product_published
       FROM p_shop_variant AS v WHERE v.id = ?`,
    )
    .bind(now.toISOString(), variantId);
}

/** What a refusal named in the address comes to, read from the database. */
function refusalOf(
  kind: RefusalKind,
  variant: VariantLookup | undefined,
): Refusal {
  const blank = {
    sku: variant?.sku ?? '',
    moq: null,
    available: null,
    max: null,
  };
  if (kind === 'quantity_too_large') {
    return { kind, ...blank, max: MAX_LINE_QUANTITY };
  }
  if (kind === 'cart_full') {
    return { kind, ...blank, max: MAX_CART_LINES };
  }
  // The two that are about a figure of the variant's own. Without the
  // variant there is no figure to state: all that can be said is that it
  // cannot be ordered.
  if (kind === 'below_moq' && variant !== undefined) {
    return { kind, ...blank, moq: variant.moq };
  }
  if (kind === 'insufficient_stock' && variant !== undefined) {
    return { kind, ...blank, available: variant.stock };
  }
  return { kind: 'unavailable', ...blank };
}

/**
 * `GET cart`: the cart page. It reads and never writes.
 *
 * Two round trips: the cart's lines and its currency — and, after a refused
 * change, the variant it was about, or after a cart was sent, the inquiry it
 * became — then everything those lines depend on.
 * An unknown, expired or absent cart is an empty one.
 */
export async function cartPage(
  _input: RouteInput,
  ctx: PluginRequestContext,
): Promise<PluginPageResult> {
  const now = new Date();
  const cookie = readCartCookie(ctx.request);
  const known = cookie !== null && isCartId(cookie) ? cookie : '';

  const asked = ctx.url.searchParams.get(REFUSED_PARAM);
  const refusedKind = REFUSALS.find((kind) => kind === asked);
  const refusedVariant =
    refusedKind === undefined
      ? ''
      : (ctx.url.searchParams.get(VARIANT_PARAM) ?? '').slice(0, 100);

  // What became of a cart sent as an inquiry: the number of the one that
  // was made, or the kind of reason none was. Only a number of the right
  // shape is looked up, and only for the cart this browser holds.
  const sentAsked = ctx.url.searchParams.get(SENT_PARAM) ?? '';
  const sentNo = known !== '' && isInquiryNo(sentAsked) ? sentAsked : '';
  const inquiryAsked = ctx.url.searchParams.get(INQUIRY_PARAM);
  const inquiryKind = INQUIRY_REFUSALS.find((kind) => kind === inquiryAsked);
  const fieldAsked = ctx.url.searchParams.get(INQUIRY_FIELD_PARAM);
  const inquiryField =
    inquiryKind === 'invalid'
      ? (INQUIRY_FIELDS.find((field) => field === fieldAsked) ?? '')
      : '';

  const [linesResult, currencyResult, variantResult, sentResult] =
    await ctx.db.batch<
      | { variant_id: string; quantity: number }
      | { currency: string | null }
      | VariantLookup
      | { inquiry_no: string }
    >([
      readCartStatement(ctx.db, known, now),
      readCartCurrencyStatement(ctx.db, known, now),
      // The variant a refusal was about. With no refusal to explain it finds
      // nothing; either way it rides in the same round trip.
      variantStatement(ctx.db, refusedVariant, now),
      // And so does the inquiry a confirmation is about.
      sentInquiryStatement(ctx.db, sentNo, known),
    ]);
  const sent = (sentResult?.results ?? [])[0] as
    | { inquiry_no: string }
    | undefined;
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
    now,
  });
  const { cart, update, inquiry } = paths(ctx);
  return {
    view: {
      ...cartView(facts, ctx.locale),
      action: update,
      cart_path: cart,
      inquiry_action: inquiry,
      // A cart with a part that has no price can be asked about though it
      // cannot be ordered; one with any other problem has to be put right.
      can_inquire: inquiryLinesOf(facts) !== null,
      sent: sent === undefined ? null : { number: sent.inquiry_no },
      inquiry_problem:
        inquiryKind === undefined
          ? null
          : { kind: inquiryKind, field: inquiryField },
      problem:
        refusedKind === undefined
          ? null
          : refusalOf(
              refusedKind,
              (variantResult?.results ?? [])[0] as VariantLookup | undefined,
            ),
    },
  };
}

/** `POST cart/update`: add a line, set its quantity, remove it, or choose a currency. */
export async function cartUpdate(
  input: RouteInput,
  ctx: PluginRequestContext,
): Promise<Response> {
  const parsed = updateSchema.safeParse(input.fields);
  if (!parsed.success) {
    // Not something a form on this site sends: no page to show for it.
    return new Response('Bad request', { status: 400 });
  }
  const form = parsed.data;
  const now = new Date();
  const { cart } = paths(ctx);
  const sentCartId = readCartCookie(ctx.request);
  const secure = ctx.url.protocol === 'https:';

  /** To the cart page, or where the form asked; with the cart's cookie when there is a cart. */
  const done = (cartId: string | null): Response => {
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
    if (sentCartId === null) {
      return done(null);
    }
    const changed = await setCartCurrencyStatement(ctx.db, {
      cartId: sentCartId,
      currency: form.currency,
      now,
    }).run();
    return done(changed.meta.changes > 0 ? sentCartId : null);
  }

  if (form.variant === '') {
    return new Response('Bad request', { status: 400 });
  }

  // One batch: the variant, whether its product can be seen, the cart as it
  // stands, and whether the cart the cookie names is a live one.
  const [variantResult, linesResult, liveResult] = await ctx.db.batch<
    | VariantLookup
    | { variant_id: string; quantity: number }
    | { currency: string | null }
  >([
    variantStatement(ctx.db, form.variant, now),
    readCartStatement(ctx.db, sentCartId ?? '', now),
    readCartCurrencyStatement(ctx.db, sentCartId ?? '', now),
  ]);

  // A cookie that names no live cart — one that expired, or an id somebody
  // chose — is not taken up. The id is all that protects a cart, so only the
  // shop issues one; and an expired cart's old lines do not come back with
  // the next thing added.
  const liveCartId =
    sentCartId !== null && (liveResult?.results ?? []).length > 0
      ? sentCartId
      : null;
  const cartId = liveCartId ?? newCartId();

  const variant = (variantResult?.results ?? [])[0] as
    | VariantLookup
    | undefined;
  const lines =
    liveCartId === null
      ? []
      : ((linesResult?.results ?? []) as {
          variant_id: string;
          quantity: number;
        }[]);
  const current =
    lines.find((line) => line.variant_id === form.variant)?.quantity ?? 0;

  const requested = Number(form.quantity);
  const target =
    form.action === 'remove'
      ? 0
      : form.action === 'set'
        ? requested
        : current + requested;

  /**
   * Back to the cart page, which says what was refused. Nothing is written
   * and no cart is created: the page shows the cart as it still is.
   */
  const refuse = (kind: RefusalKind): Response => {
    const query = new URLSearchParams({
      [REFUSED_PARAM]: kind,
      [VARIANT_PARAM]: form.variant,
    });
    return new Response(null, {
      status: 303,
      headers: { location: `${cart}?${query.toString()}` },
    });
  };

  if (target > 0) {
    if (variant === undefined || variant.product_published !== 1) {
      return refuse('unavailable');
    }
    const issue = quantityIssue(variant, target);
    if (issue !== null) {
      return refuse(
        issue.kind === 'below_moq' ||
          issue.kind === 'quantity_too_large' ||
          issue.kind === 'insufficient_stock'
          ? issue.kind
          : 'unavailable',
      );
    }
    if (current === 0 && lines.length >= MAX_CART_LINES) {
      return refuse('cart_full');
    }
  }

  // Removing a line that is not there, from a cart that does not exist, has
  // nothing to write — and must not create a cart as a side effect.
  if (target > 0 || current > 0) {
    // A form that names no currency leaves the cart's own as it is, and a
    // new cart starts in its language's.
    const currency = isCurrency(form.currency)
      ? form.currency
      : liveCartId === null
        ? defaultCurrencyForLocale(ctx.locale)
        : null;
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

  return done(target > 0 || liveCartId !== null ? cartId : null);
}
