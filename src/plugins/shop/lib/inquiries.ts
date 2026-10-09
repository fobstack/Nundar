/**
 * A cart sent as one inquiry: a request for a quote.
 *
 * The buyer fills a cart, says who they are, and sends it. Nothing is
 * charged and no stock is taken: the seller answers by email. So an inquiry
 * may hold what an order may not — a part with no price — and that is the
 * point of it.
 *
 * What is sent is the cart as the database has it when the form arrives,
 * judged by the same reading the cart page shows (`readCartFacts`), and
 * stored as a snapshot: a later change to a product changes no inquiry.
 *
 * It is the one place the shop holds what a person typed about themselves
 * before there is an order.
 */

import { z } from 'zod';
import type { CartFacts } from './cart-pricing.js';
import {
  BASE_CURRENCY,
  CURRENCY_MINOR_UNITS,
  type Currency,
  isCurrency,
} from './currency.js';
import { formatMoney, fromMinor, sumMinor } from './money.js';
import { isReference, newReference } from './reference.js';

/** What an inquiry's number begins with: a request for a quotation. */
export const INQUIRY_NO_PREFIX = 'RFQ';

/**
 * How many inquiries one visitor may send in an hour.
 *
 * Mallok's rate limit is, in Cloudflare's own words, permissive and
 * eventually consistent; this one is exact, because it is counted in the
 * table inside the write. It is here for the seller's inbox: every inquiry
 * is an email, and the form has no challenge in front of it.
 */
export const MAX_INQUIRIES_PER_HOUR = 5;

const HOUR_MS = 60 * 60 * 1000;

/**
 * How long after an inquiry a second request from the same cart is taken for
 * the same one: a button pressed twice, a form sent again by a reload.
 */
const SAME_SUBMISSION_MS = 2 * 60 * 1000;

export const INQUIRY_STATUSES = ['new', 'answered', 'spam'] as const;

export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];

/**
 * What an address may be, as the source of a pattern. The form carries
 * exactly this in its `pattern`, and a browser compiles that the way the
 * server does below, so the two agree on every address.
 *
 * It is a list of what is allowed, not of what is not: letters and digits of
 * any script, and the few signs addresses really use. An address ends up in
 * places where other characters mean something — `?`, `&` and `%` in the
 * `mailto:` link an admin makes of it, where they would add a recipient or a
 * subject of the buyer's choosing; `,` and `<` in the reply address of an
 * email. The rare real address with `&` or `!` in it is refused with them.
 */
export const EMAIL_PATTERN_SOURCE =
  "[\\p{L}\\p{N}._+'\\-]+@[\\p{L}\\p{N}\\-]+(\\.[\\p{L}\\p{N}\\-]+)+";

/** The `v` flag is the one a browser gives a `pattern`. */
export const EMAIL_PATTERN = new RegExp(`^(?:${EMAIL_PATTERN_SOURCE})$`, 'v');

/**
 * What a name must have: something that is not a space. The form carries it
 * as the name's `pattern`, since `required` alone is satisfied by spaces.
 */
export const NAME_PATTERN_SOURCE = '.*\\S.*';

/** No control character: what is left to refuse once white space is one space. */
const NO_CONTROL = /^[^\p{Cc}]*$/u;

/** The length each field may have. The form carries the same in `maxlength`. */
export const INQUIRY_LIMITS = {
  name: 200,
  email: 320,
  company: 200,
  phone: 60,
  message: 5000,
} as const;

/** The fields a buyer fills in, in the order a page shows them. */
export const INQUIRY_FIELDS = [
  'name',
  'email',
  'company',
  'phone',
  'message',
] as const;

export type InquiryField = (typeof INQUIRY_FIELDS)[number];

/**
 * One line of text: a name, a company, a phone number.
 *
 * White space of any kind — a tab pasted from a spreadsheet, a line break —
 * becomes one space, rather than being refused: a browser lets a person type
 * or paste it, and a form the server refuses comes back empty. What is
 * stored is one line either way, which is what an email's subject needs.
 */
function oneLine(max: number, min = 0) {
  return z
    .string()
    .default('')
    .transform((value) => value.replace(/\s+/gu, ' ').trim())
    .pipe(z.string().min(min).max(max).regex(NO_CONTROL));
}

export const inquiryFormSchema = z.object({
  name: oneLine(INQUIRY_LIMITS.name, 1),
  email: z
    .string()
    .default('')
    .transform((value) => value.trim())
    .pipe(z.string().min(3).max(INQUIRY_LIMITS.email).regex(EMAIL_PATTERN)),
  company: oneLine(INQUIRY_LIMITS.company),
  phone: oneLine(INQUIRY_LIMITS.phone),
  // A browser counts a line break as one character and sends it as two. It
  // is made one again before it is counted, so that a message the field let
  // through is not one the server finds too long.
  message: z
    .string()
    .default('')
    .transform((value) => value.replace(/\r\n?/g, '\n').trim())
    .pipe(z.string().max(INQUIRY_LIMITS.message)),
  /** A field no person sees. Whatever fills it in is not one. */
  website: z.string().max(500).default(''),
});

export type InquiryForm = z.infer<typeof inquiryFormSchema>;

/** The first field a form got wrong, in the order the page shows them. */
export function firstInvalidField(error: z.ZodError): InquiryField | null {
  const named = new Set(error.issues.map((issue) => issue.path[0]));
  return INQUIRY_FIELDS.find((field) => named.has(field)) ?? null;
}

export function newInquiryNo(now: Date): string {
  return newReference(INQUIRY_NO_PREFIX, now);
}

export function isInquiryNo(value: string): boolean {
  return isReference(INQUIRY_NO_PREFIX, value);
}

/** One line of an inquiry, as it is stored. */
export interface InquiryLine {
  readonly variantId: string;
  readonly sku: string;
  readonly name: string;
  readonly quantity: number;
  /** Null when the variant has no price in the inquiry's currency. */
  readonly unitPriceMinor: number | null;
}

/**
 * The lines a cart would send, or null when it cannot be sent as it stands.
 *
 * A line without a price is what an inquiry is for. Any other problem — the
 * part is gone, fewer than its minimum order, more than a line may hold or
 * than there is — has to be put right first: the buyer is shown it on the
 * line, and a seller is not sent a request the shop itself would refuse.
 */
export function inquiryLinesOf(facts: CartFacts): InquiryLine[] | null {
  if (facts.lines.length === 0) {
    return null;
  }
  const lines: InquiryLine[] = [];
  for (const line of facts.lines) {
    if (
      line.name === null ||
      (line.issue !== null && line.issue.kind !== 'no_price')
    ) {
      return null;
    }
    lines.push({
      variantId: line.variantId,
      sku: line.sku,
      name: line.name,
      quantity: line.quantity,
      unitPriceMinor: line.unitPriceMinor,
    });
  }
  return lines;
}

/** What the lines come to; null when one of them has no price. */
export function inquirySubtotalMinor(
  lines: readonly InquiryLine[],
): number | null {
  const totals: number[] = [];
  for (const line of lines) {
    if (line.unitPriceMinor === null) {
      return null;
    }
    totals.push(line.unitPriceMinor * line.quantity);
  }
  return sumMinor(totals);
}

export interface NewInquiry {
  readonly id: string;
  readonly inquiryNo: string;
  readonly cartId: string;
  readonly form: InquiryForm;
  readonly locale: string;
  readonly currency: Currency;
  readonly country: string;
  readonly ipHash: string | null;
  readonly lines: readonly InquiryLine[];
  readonly now: Date;
}

/**
 * The statements that store an inquiry and empty the cart it came from, for
 * one batch. The first is the inquiry itself, and the caller reads whether
 * it wrote a row from that statement's result.
 *
 * The inquiry is written only while the cart is still exactly what is being
 * sent — the same lines, in the same quantities, and no other — and the
 * visitor is under their limit, and both are asked inside the write. So a
 * form sent twice at the same moment stores one inquiry: the second batch
 * finds the cart the first one emptied. And a cart that changed between
 * being read and being written is not sent as it no longer is, nor emptied
 * of what was put in it meanwhile. Everything after is conditional on the
 * inquiry being there — a refused inquiry must leave the cart as it was.
 */
export function inquiryStatements(
  db: D1Database,
  input: NewInquiry,
): D1PreparedStatement[] {
  const { form, lines, currency, locale } = input;
  const nowIso = input.now.toISOString();
  const subtotalMinor = inquirySubtotalMinor(lines);
  const money = (minor: number | null): string =>
    minor === null ? '' : formatMoney(minor, currency, locale);

  const inquiry = db
    .prepare(
      `INSERT INTO p_shop_inquiry
         (id, inquiry_no, status, name, email, company, phone, message,
          locale, currency, country, line_count, subtotal_minor, subtotal,
          cart_id, ip_hash, created_at, updated_at)
       SELECT ?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE NOT EXISTS (
               SELECT 1 FROM json_each(?) AS sent
               WHERE NOT EXISTS (
                 SELECT 1 FROM p_shop_cart_line
                 WHERE cart_id = ?
                   AND variant_id = json_extract(sent.value, '$.variantId')
                   AND quantity = json_extract(sent.value, '$.quantity')
               )
             )
         AND (SELECT COUNT(*) FROM p_shop_cart_line WHERE cart_id = ?) = ?
         AND (SELECT COUNT(*) FROM p_shop_inquiry
              WHERE ip_hash IS ? AND created_at > ?) < ?`,
    )
    .bind(
      input.id,
      input.inquiryNo,
      form.name,
      form.email,
      form.company,
      form.phone,
      form.message,
      locale,
      currency,
      input.country,
      lines.length,
      subtotalMinor,
      money(subtotalMinor),
      input.cartId,
      input.ipHash,
      nowIso,
      nowIso,
      JSON.stringify(
        lines.map((line) => ({
          variantId: line.variantId,
          quantity: line.quantity,
        })),
      ),
      input.cartId,
      input.cartId,
      lines.length,
      input.ipHash,
      new Date(input.now.getTime() - HOUR_MS).toISOString(),
      MAX_INQUIRIES_PER_HOUR,
    );

  // The lines travel as one JSON parameter: one statement however many.
  const stored = db
    .prepare(
      `INSERT INTO p_shop_inquiry_line
         (id, inquiry_id, position, variant_id, sku, name, quantity,
          unit_price_minor, unit_price, line_total)
       SELECT ? || ':' || j.key, ?, j.key,
              json_extract(j.value, '$.variantId'),
              json_extract(j.value, '$.sku'),
              json_extract(j.value, '$.name'),
              json_extract(j.value, '$.quantity'),
              json_extract(j.value, '$.unitPriceMinor'),
              json_extract(j.value, '$.unitPrice'),
              json_extract(j.value, '$.lineTotal')
       FROM json_each(?) AS j
       WHERE EXISTS (SELECT 1 FROM p_shop_inquiry WHERE id = ?)`,
    )
    .bind(
      input.id,
      input.id,
      JSON.stringify(
        lines.map((line) => ({
          ...line,
          unitPrice: money(line.unitPriceMinor),
          lineTotal: money(
            line.unitPriceMinor === null
              ? null
              : line.unitPriceMinor * line.quantity,
          ),
        })),
      ),
      input.id,
    );

  // The cart's row stays: its id is how the page that confirms the inquiry
  // knows the browser in front of it is the one that sent it.
  const emptied = db
    .prepare(
      `DELETE FROM p_shop_cart_line
       WHERE cart_id = ?
         AND EXISTS (SELECT 1 FROM p_shop_inquiry WHERE id = ?)`,
    )
    .bind(input.cartId, input.id);

  return [inquiry, stored, emptied];
}

/**
 * How many inquiries a visitor has sent in the last hour.
 *
 * `IS`, not `=`: a request Mallok could give no mark — one that reached the
 * Worker without a connecting address — is counted with every other such
 * request, as one visitor. Mallok's own rate limit does the same. The other
 * choice, no limit at all for them, would switch the limit off for a whole
 * site whose requests arrive that way.
 */
export function visitorCountStatement(
  db: D1Database,
  ipHash: string | null,
  now: Date,
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT COUNT(*) AS n FROM p_shop_inquiry
       WHERE ip_hash IS ? AND created_at > ?`,
    )
    .bind(ipHash, new Date(now.getTime() - HOUR_MS).toISOString());
}

/** Whether that count is the most a visitor may send. */
export function atVisitorLimit(sent: number): boolean {
  return sent >= MAX_INQUIRIES_PER_HOUR;
}

/** Why an inquiry was not stored, read from the data after the write. */
export type InquiryNotStored =
  /** This cart was sent a moment ago: the same request, arriving twice. */
  | { readonly kind: 'sent'; readonly inquiryNo: string }
  | { readonly kind: 'too_many' }
  /** The cart is not what was being sent any more. */
  | { readonly kind: 'cart_changed' }
  | { readonly kind: 'empty' };

/**
 * What stood in the way of an inquiry that wrote nothing.
 *
 * Read from the tables, not guessed from the write, and in this order. The
 * cart is still exactly what was being sent, and the visitor is at their
 * limit: it was the limit. The cart has something else in it now: it
 * changed, and the buyer should look at it before sending. The cart is
 * empty and was sent a moment ago: this is that same request, arriving a
 * second time, and is told the number of the first. Otherwise there was
 * nothing to send.
 *
 * `lines` is what was being sent; none, when the cart was already empty as
 * it was read.
 */
export async function whyNotStored(
  db: D1Database,
  input: {
    readonly cartId: string;
    readonly ipHash: string | null;
    readonly now: Date;
    readonly lines: readonly Pick<InquiryLine, 'variantId' | 'quantity'>[];
  },
): Promise<InquiryNotStored> {
  const { cartId, ipHash, now, lines } = input;
  const [recentResult, countResult, cartResult] = await db.batch<
    | { inquiry_no: string }
    | { n: number }
    | { variant_id: string; quantity: number }
  >([
    db
      .prepare(
        `SELECT inquiry_no FROM p_shop_inquiry
         WHERE cart_id = ? AND created_at > ?
         ORDER BY created_at DESC LIMIT 1`,
      )
      .bind(cartId, new Date(now.getTime() - SAME_SUBMISSION_MS).toISOString()),
    visitorCountStatement(db, ipHash, now),
    db
      .prepare(
        'SELECT variant_id, quantity FROM p_shop_cart_line WHERE cart_id = ?',
      )
      .bind(cartId),
  ]);
  const inCart = (cartResult?.results ?? []) as {
    variant_id: string;
    quantity: number;
  }[];
  const unchanged =
    lines.length > 0 &&
    inCart.length === lines.length &&
    lines.every((line) =>
      inCart.some(
        (row) =>
          row.variant_id === line.variantId && row.quantity === line.quantity,
      ),
    );
  const sent =
    ((countResult?.results ?? [])[0] as { n: number } | undefined)?.n ?? 0;
  if (unchanged && atVisitorLimit(sent)) {
    return { kind: 'too_many' };
  }
  if (inCart.length > 0) {
    return { kind: 'cart_changed' };
  }
  const recent = (recentResult?.results ?? [])[0] as
    | { inquiry_no: string }
    | undefined;
  return recent === undefined
    ? { kind: 'empty' }
    : { kind: 'sent', inquiryNo: recent.inquiry_no };
}

/**
 * The statement the cart page confirms an inquiry by: its number, and only
 * for the cart it was sent from. A number alone, in a link somebody made
 * up, finds nothing.
 */
export function sentInquiryStatement(
  db: D1Database,
  inquiryNo: string,
  cartId: string,
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT inquiry_no FROM p_shop_inquiry
       WHERE inquiry_no = ? AND cart_id = ?`,
    )
    .bind(inquiryNo, cartId);
}

/** An inquiry with its lines, as the emails and the export read it. */
export interface InquiryDetail {
  readonly id: string;
  readonly inquiryNo: string;
  readonly status: string;
  readonly name: string;
  readonly email: string;
  readonly company: string;
  readonly phone: string;
  readonly message: string;
  readonly locale: string;
  readonly currency: string;
  readonly country: string;
  readonly subtotalMinor: number | null;
  readonly notifiedAt: string | null;
  readonly acknowledgedAt: string | null;
  readonly createdAt: string;
  readonly lines: readonly InquiryLine[];
}

interface InquiryRow {
  id: string;
  inquiry_no: string;
  status: string;
  name: string;
  email: string;
  company: string;
  phone: string;
  message: string;
  locale: string;
  currency: string;
  country: string;
  subtotal_minor: number | null;
  notified_at: string | null;
  acknowledged_at: string | null;
  created_at: string;
}

interface InquiryLineRow {
  inquiry_id: string;
  variant_id: string;
  sku: string;
  name: string;
  quantity: number;
  unit_price_minor: number | null;
}

const INQUIRY_COLUMNS = `id, inquiry_no, status, name, email, company, phone,
  message, locale, currency, country, subtotal_minor, notified_at,
  acknowledged_at, created_at`;

const LINE_COLUMNS =
  'inquiry_id, variant_id, sku, name, quantity, unit_price_minor';

function detailsOf(
  inquiries: readonly InquiryRow[],
  lines: readonly InquiryLineRow[],
): InquiryDetail[] {
  // One pass over the lines, not one for each inquiry: an export holds a
  // thousand inquiries, and the Worker's CPU is counted in milliseconds.
  const byInquiry = new Map<string, InquiryLine[]>();
  for (const line of lines) {
    const own = byInquiry.get(line.inquiry_id) ?? [];
    own.push({
      variantId: line.variant_id,
      sku: line.sku,
      name: line.name,
      quantity: line.quantity,
      unitPriceMinor: line.unit_price_minor,
    });
    byInquiry.set(line.inquiry_id, own);
  }
  return inquiries.map((row) => ({
    id: row.id,
    inquiryNo: row.inquiry_no,
    status: row.status,
    name: row.name,
    email: row.email,
    company: row.company,
    phone: row.phone,
    message: row.message,
    locale: row.locale,
    currency: row.currency,
    country: row.country,
    subtotalMinor: row.subtotal_minor,
    notifiedAt: row.notified_at,
    acknowledgedAt: row.acknowledged_at,
    createdAt: row.created_at,
    lines: byInquiry.get(row.id) ?? [],
  }));
}

/** One inquiry and its lines, in one round trip; null when it is not there. */
export async function readInquiry(
  db: D1Database,
  id: string,
): Promise<InquiryDetail | null> {
  const [inquiryResult, lineResult] = await db.batch<
    InquiryRow | InquiryLineRow
  >([
    db
      .prepare(`SELECT ${INQUIRY_COLUMNS} FROM p_shop_inquiry WHERE id = ?`)
      .bind(id),
    db
      .prepare(
        `SELECT ${LINE_COLUMNS} FROM p_shop_inquiry_line
         WHERE inquiry_id = ? ORDER BY position`,
      )
      .bind(id),
  ]);
  return (
    detailsOf(
      (inquiryResult?.results ?? []) as InquiryRow[],
      (lineResult?.results ?? []) as InquiryLineRow[],
    )[0] ?? null
  );
}

/**
 * The inquiries an export takes: the ones named, or the latest when none
 * is, newest first, with their lines. Two statements however many.
 */
export async function readInquiries(
  db: D1Database,
  ids: readonly string[],
  limit: number,
): Promise<InquiryDetail[]> {
  const named = JSON.stringify(ids.slice(0, limit));
  const chosen =
    ids.length === 0
      ? `SELECT id FROM p_shop_inquiry ORDER BY created_at DESC, id LIMIT ?2`
      : `SELECT id FROM p_shop_inquiry
         WHERE id IN (SELECT value FROM json_each(?1)) LIMIT ?2`;
  const [inquiryResult, lineResult] = await db.batch<
    InquiryRow | InquiryLineRow
  >([
    db
      .prepare(
        `SELECT ${INQUIRY_COLUMNS} FROM p_shop_inquiry
         WHERE id IN (${chosen}) ORDER BY created_at DESC, id`,
      )
      .bind(named, limit),
    db
      .prepare(
        `SELECT ${LINE_COLUMNS} FROM p_shop_inquiry_line
         WHERE inquiry_id IN (${chosen}) ORDER BY inquiry_id, position`,
      )
      .bind(named, limit),
  ]);
  return detailsOf(
    (inquiryResult?.results ?? []) as InquiryRow[],
    (lineResult?.results ?? []) as InquiryLineRow[],
  );
}

/** Sets the status of the inquiries named; one statement however many. */
export function markInquiriesStatement(
  db: D1Database,
  ids: readonly string[],
  status: InquiryStatus,
  now: Date,
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE p_shop_inquiry SET status = ?, updated_at = ?
       WHERE id IN (SELECT value FROM json_each(?))`,
    )
    .bind(status, now.toISOString(), JSON.stringify(ids));
}

/**
 * The statements that remove the inquiries named, with their lines, for one
 * batch. It is how what a person typed about themselves is erased when they
 * ask, and how a flood of spam is cleared.
 */
export function deleteInquiriesStatements(
  db: D1Database,
  ids: readonly string[],
): D1PreparedStatement[] {
  const named = JSON.stringify(ids);
  return [
    db
      .prepare(
        `DELETE FROM p_shop_inquiry_line
         WHERE inquiry_id IN (SELECT value FROM json_each(?))`,
      )
      .bind(named),
    db
      .prepare(
        `DELETE FROM p_shop_inquiry
         WHERE id IN (SELECT value FROM json_each(?))`,
      )
      .bind(named),
  ];
}

/**
 * A cell that a spreadsheet would run as a formula, made into text.
 *
 * What a buyer typed ends up in a file the seller opens, and a cell that
 * begins with `=`, `+`, `-` or `@` is a formula to a spreadsheet — one that
 * can fetch an address or start a program. A leading apostrophe makes it
 * text again, which is what OWASP's guidance on CSV injection asks for.
 *
 * Not only at the start of the value. Where the list separator is a
 * semicolon — German, French and Spanish settings among them — a
 * spreadsheet opening this file splits a row on `;`, whatever the quotes
 * say, and each piece is a cell of its own: `x;=1+1` is two. A line break
 * inside a value starts a row the same way. So the apostrophe goes in front
 * of every one of those signs that such a spreadsheet could find at the
 * start of a cell.
 */
function inert(value: string): string {
  return value.replace(/(^|[;\t\r\n])([=+\-@])/g, "$1'$2");
}

function csvCell(value: string | number | null): string {
  if (value === null) {
    return '';
  }
  const text = typeof value === 'number' ? String(value) : inert(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const CSV_HEADER = [
  'inquiry_no',
  'created_at',
  'status',
  'name',
  'company',
  'email',
  'phone',
  'country',
  'locale',
  'currency',
  'sku',
  'product',
  'quantity',
  'unit_price',
  'line_total',
  'message',
] as const;

/**
 * Inquiries as CSV, one row for each line of each, so that a spreadsheet
 * can total by part or by buyer. Amounts are plain decimal numbers, in the
 * currency named on the row, and empty where a line had no price.
 */
export function inquiriesCsv(inquiries: readonly InquiryDetail[]): string {
  // For a machine: digits and a decimal point, no symbol and no grouping.
  const decimal = (minor: number | null, currency: string): string => {
    if (minor === null) {
      return '';
    }
    const known = isCurrency(currency) ? currency : BASE_CURRENCY;
    return fromMinor(minor, known).toFixed(CURRENCY_MINOR_UNITS[known]);
  };
  const rows = inquiries.flatMap((inquiry) =>
    inquiry.lines.map((line) =>
      [
        inquiry.inquiryNo,
        inquiry.createdAt,
        inquiry.status,
        inquiry.name,
        inquiry.company,
        inquiry.email,
        inquiry.phone,
        inquiry.country,
        inquiry.locale,
        inquiry.currency,
        line.sku,
        line.name,
        line.quantity,
        decimal(line.unitPriceMinor, inquiry.currency),
        decimal(
          line.unitPriceMinor === null
            ? null
            : line.unitPriceMinor * line.quantity,
          inquiry.currency,
        ),
        inquiry.message,
      ]
        .map(csvCell)
        .join(','),
    ),
  );
  // CRLF, as RFC 4180 has it, and a byte order mark so that a spreadsheet
  // reads names outside ASCII as what they are.
  return `﻿${[CSV_HEADER.join(','), ...rows].join('\r\n')}\r\n`;
}
