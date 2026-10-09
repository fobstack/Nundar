/**
 * The two emails an inquiry sends: one tells the seller, one tells the buyer
 * it arrived.
 *
 * The seller's is in English, like the admin, and is answered straight to
 * the buyer: its reply address is theirs. The buyer's is in the language the
 * cart was sent in. Each carries a plain-text part beside the HTML, as the
 * order emails do.
 *
 * Everything a buyer typed is in these, and every value goes through
 * `escapeHtml` on its way into markup. These build the content only; sending
 * is Mallok's `ctx.sendEmail`.
 */

import { escapeHtml } from 'mallok/worker';
import { BASE_CURRENCY, type Currency, isCurrency } from './currency.js';
import type { InquiryDetail, InquiryLine } from './inquiries.js';
import { formatMoney } from './money.js';
import type { EmailContent } from './order-email.js';

interface Copy {
  readonly subject: (inquiryNo: string) => string;
  readonly intro: string;
  readonly itemsHeading: string;
  readonly subtotalLabel: string;
  readonly onRequest: string;
  readonly signOff: string;
}

const ENGLISH: Copy = {
  subject: (inquiryNo) => `We have received your request ${inquiryNo}`,
  intro:
    'Thank you for your request. We have received it and will answer by email.',
  itemsHeading: 'What you asked about',
  subtotalLabel: 'Subtotal',
  onRequest: 'on request',
  signOff: 'If you have anything to add, simply reply to this email.',
};

const COPY: Readonly<Record<string, Copy>> = {
  en: ENGLISH,
  de: {
    subject: (inquiryNo) => `Ihre Anfrage ${inquiryNo} ist eingegangen`,
    intro:
      'Vielen Dank für Ihre Anfrage. Sie ist bei uns eingegangen, und wir antworten Ihnen per E-Mail.',
    itemsHeading: 'Ihre Anfrage',
    subtotalLabel: 'Zwischensumme',
    onRequest: 'auf Anfrage',
    signOff:
      'Wenn Sie etwas ergänzen möchten, antworten Sie einfach auf diese E-Mail.',
  },
  fr: {
    subject: (inquiryNo) => `Nous avons bien reçu votre demande ${inquiryNo}`,
    intro:
      'Merci pour votre demande. Nous l’avons bien reçue et vous répondrons par e-mail.',
    itemsHeading: 'Votre demande',
    subtotalLabel: 'Sous-total',
    onRequest: 'sur demande',
    signOff: 'Pour toute précision, répondez simplement à cet e-mail.',
  },
  es: {
    subject: (inquiryNo) => `Hemos recibido su solicitud ${inquiryNo}`,
    intro:
      'Gracias por su solicitud. La hemos recibido y le responderemos por correo electrónico.',
    itemsHeading: 'Su solicitud',
    subtotalLabel: 'Subtotal',
    onRequest: 'a consultar',
    signOff: 'Si desea añadir algo, responda a este correo.',
  },
};

/** The language to write in; a language without a translation reads English. */
function languageOf(locale: string): string {
  const language = locale.toLowerCase().split('-')[0] ?? '';
  return Object.hasOwn(COPY, language) ? language : 'en';
}

function currencyOf(inquiry: Pick<InquiryDetail, 'currency'>): Currency {
  return isCurrency(inquiry.currency) ? inquiry.currency : BASE_CURRENCY;
}

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html>
<body style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;line-height:1.6;color:#171717;">
<h1 style="font-size:20px;">${escapeHtml(title)}</h1>
${bodyHtml}
</body>
</html>`;
}

/** The lines as both parts of an email show them. */
function linesOf(
  lines: readonly InquiryLine[],
  currency: Currency,
  language: string,
  onRequest: string,
): { readonly text: string; readonly html: string } {
  const amount = (line: InquiryLine): string =>
    line.unitPriceMinor === null
      ? onRequest
      : formatMoney(line.unitPriceMinor * line.quantity, currency, language);
  const each = (line: InquiryLine): string =>
    line.unitPriceMinor === null
      ? onRequest
      : formatMoney(line.unitPriceMinor, currency, language);
  return {
    text: lines
      .map(
        (line) =>
          `${line.sku}  ${line.name}  × ${line.quantity}  ${each(line)}  ${amount(line)}`,
      )
      .join('\n'),
    html: `<table style="border-collapse:collapse;">
${lines
  .map(
    (line) =>
      `<tr><td style="padding:2px 12px 2px 0;font-family:ui-monospace,monospace;">${escapeHtml(line.sku)}</td><td style="padding:2px 12px 2px 0;">${escapeHtml(line.name)}</td><td style="padding:2px 12px 2px 0;text-align:right;">× ${line.quantity}</td><td style="padding:2px 12px 2px 0;text-align:right;">${escapeHtml(each(line))}</td><td style="padding:2px 0;text-align:right;">${escapeHtml(amount(line))}</td></tr>`,
  )
  .join('\n')}
</table>`,
  };
}

/** Text a buyer typed over several lines, as HTML that keeps the lines. */
function paragraphs(text: string): string {
  return escapeHtml(text).replace(/\r?\n/g, '<br>');
}

/**
 * The email that tells the seller. Its reply address is the buyer's, which
 * the caller sets from `replyTo`.
 */
export function inquiryNotificationEmail(
  inquiry: InquiryDetail,
  siteName: string,
): EmailContent & { readonly replyTo: string } {
  const currency = currencyOf(inquiry);
  const lines = linesOf(inquiry.lines, currency, 'en', 'on request');
  const from =
    inquiry.company === ''
      ? inquiry.name
      : `${inquiry.name}, ${inquiry.company}`;
  const subject = `Inquiry ${inquiry.inquiryNo} from ${from}`;
  const subtotal =
    inquiry.subtotalMinor === null
      ? 'Not stated: at least one line has no price.'
      : formatMoney(inquiry.subtotalMinor, currency, 'en');
  const who: (readonly [string, string])[] = [
    ['Name', inquiry.name],
    ['Company', inquiry.company],
    ['Email', inquiry.email],
    ['Phone', inquiry.phone],
    ['Country', inquiry.country],
    ['Language', inquiry.locale],
    ['Currency', inquiry.currency],
  ];
  const stated = who.filter(([, value]) => value !== '');

  const text = [
    `A cart was sent as an inquiry on ${siteName}.`,
    '',
    ...stated.map(([label, value]) => `${label}: ${value}`),
    '',
    lines.text,
    '',
    `Subtotal: ${subtotal}`,
    ...(inquiry.message === '' ? [] : ['', 'Message:', inquiry.message]),
    '',
    'Reply to this email to answer the buyer.',
  ].join('\n');

  const html = layout(
    subject,
    [
      `<p>A cart was sent as an inquiry on ${escapeHtml(siteName)}.</p>`,
      `<table style="border-collapse:collapse;">${stated
        .map(
          ([label, value]) =>
            `<tr><th style="text-align:left;padding:2px 12px 2px 0;font-weight:600;">${escapeHtml(label)}</th><td style="padding:2px 0;">${escapeHtml(value)}</td></tr>`,
        )
        .join('')}</table>`,
      lines.html,
      `<p><strong>Subtotal:</strong> ${escapeHtml(subtotal)}</p>`,
      ...(inquiry.message === ''
        ? []
        : [
            `<p><strong>Message</strong></p><p>${paragraphs(inquiry.message)}</p>`,
          ]),
      '<p>Reply to this email to answer the buyer.</p>',
    ].join('\n'),
  );

  return { subject, text, html, replyTo: inquiry.email };
}

/** The email that tells the buyer their request arrived, in their language. */
export function inquiryAcknowledgementEmail(
  inquiry: InquiryDetail,
): EmailContent {
  const language = languageOf(inquiry.locale);
  const copy = COPY[language] ?? ENGLISH;
  const currency = currencyOf(inquiry);
  const lines = linesOf(inquiry.lines, currency, language, copy.onRequest);
  const subject = copy.subject(inquiry.inquiryNo);
  const subtotal =
    inquiry.subtotalMinor === null
      ? null
      : formatMoney(inquiry.subtotalMinor, currency, language);

  const text = [
    copy.intro,
    '',
    `${copy.itemsHeading}:`,
    lines.text,
    ...(subtotal === null ? [] : ['', `${copy.subtotalLabel}: ${subtotal}`]),
    '',
    copy.signOff,
  ].join('\n');

  const html = layout(
    subject,
    [
      `<p>${escapeHtml(copy.intro)}</p>`,
      `<p><strong>${escapeHtml(copy.itemsHeading)}</strong></p>`,
      lines.html,
      ...(subtotal === null
        ? []
        : [
            `<p><strong>${escapeHtml(copy.subtotalLabel)}:</strong> ${escapeHtml(subtotal)}</p>`,
          ]),
      `<p>${escapeHtml(copy.signOff)}</p>`,
    ].join('\n'),
  );

  return { subject, text, html };
}
