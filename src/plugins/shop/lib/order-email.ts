/**
 * The two emails an order sends its buyer: payment confirmed, and shipped.
 *
 * Each is written in the language the order was placed in, and each carries a
 * plain-text part beside the HTML: HTML alone renders blank in some clients
 * and raises the spam score.
 *
 * These build the content only. Sending is Mallok's `ctx.sendEmail`.
 */

import { escapeHtml } from 'mallok/worker';
import { formatMoney } from './money.js';
import type { OrderDetail } from './orders.js';

export interface EmailContent {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

interface Copy {
  readonly confirmSubject: (orderNo: string) => string;
  readonly confirmIntro: string;
  readonly itemsHeading: string;
  readonly totalLabel: string;
  readonly leadTime: (days: number) => string;
  readonly shipSubject: (orderNo: string) => string;
  readonly shipIntro: string;
  readonly trackingLabel: string;
  readonly signOff: string;
}

const ENGLISH: Copy = {
  confirmSubject: (orderNo) => `Order ${orderNo} confirmed`,
  confirmIntro: 'Thank you for your order. We have received your payment.',
  itemsHeading: 'Items',
  totalLabel: 'Total',
  leadTime: (days) => `Expected to ship within ${days} business days.`,
  shipSubject: (orderNo) => `Order ${orderNo} has shipped`,
  shipIntro: 'Your order is on its way.',
  trackingLabel: 'Tracking number',
  signOff: 'If you have any questions, simply reply to this email.',
};

const COPY: Readonly<Record<string, Copy>> = {
  en: ENGLISH,
  de: {
    confirmSubject: (orderNo) => `Bestellung ${orderNo} bestätigt`,
    confirmIntro:
      'Vielen Dank für Ihre Bestellung. Ihre Zahlung ist bei uns eingegangen.',
    itemsHeading: 'Artikel',
    totalLabel: 'Gesamt',
    leadTime: (days) =>
      `Voraussichtlicher Versand innerhalb von ${days} Werktagen.`,
    shipSubject: (orderNo) => `Bestellung ${orderNo} wurde versandt`,
    shipIntro: 'Ihre Bestellung ist unterwegs.',
    trackingLabel: 'Sendungsnummer',
    signOff: 'Bei Fragen antworten Sie einfach auf diese E-Mail.',
  },
  fr: {
    confirmSubject: (orderNo) => `Commande ${orderNo} confirmée`,
    confirmIntro:
      'Merci pour votre commande. Nous avons bien reçu votre paiement.',
    itemsHeading: 'Articles',
    totalLabel: 'Total',
    leadTime: (days) => `Expédition prévue sous ${days} jours ouvrés.`,
    shipSubject: (orderNo) => `Commande ${orderNo} expédiée`,
    shipIntro: 'Votre commande est en route.',
    trackingLabel: 'Numéro de suivi',
    signOff: 'Pour toute question, répondez simplement à cet e-mail.',
  },
  es: {
    confirmSubject: (orderNo) => `Pedido ${orderNo} confirmado`,
    confirmIntro: 'Gracias por su pedido. Hemos recibido su pago.',
    itemsHeading: 'Artículos',
    totalLabel: 'Total',
    leadTime: (days) => `Envío previsto en ${days} días hábiles.`,
    shipSubject: (orderNo) => `Pedido ${orderNo} enviado`,
    shipIntro: 'Su pedido está en camino.',
    trackingLabel: 'Número de seguimiento',
    signOff: 'Si tiene alguna pregunta, responda a este correo.',
  },
};

/**
 * The language to write in, as one of the keys above.
 *
 * A regional variant uses its language (`de-AT` reads German); anything
 * without a translation reads English. The same key then formats the money,
 * so a locale that is not even well-formed cannot stop the email from being
 * built.
 */
function languageOf(locale: string): string {
  const language = locale.toLowerCase().split('-')[0] ?? '';
  return Object.hasOwn(COPY, language) ? language : 'en';
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

/** The confirmation sent once, when an order's payment is confirmed. */
export function orderConfirmationEmail(
  order: Pick<
    OrderDetail,
    | 'orderNo'
    | 'currency'
    | 'totalMinor'
    | 'locale'
    | 'lines'
    | 'leadTimeDaysMax'
  >,
): EmailContent {
  const language = languageOf(order.locale);
  const copy = COPY[language] ?? ENGLISH;
  const money = (minor: number) => formatMoney(minor, order.currency, language);

  const subject = copy.confirmSubject(order.orderNo);
  const leadTimeLine =
    order.leadTimeDaysMax === null
      ? null
      : copy.leadTime(order.leadTimeDaysMax);

  const text = [
    copy.confirmIntro,
    '',
    `${copy.itemsHeading}:`,
    ...order.lines.map(
      (line) =>
        `- ${line.name} (${line.sku}) × ${line.quantity} — ${money(
          line.unitPriceMinor * line.quantity,
        )}`,
    ),
    '',
    `${copy.totalLabel}: ${money(order.totalMinor)}`,
    ...(leadTimeLine === null ? [] : ['', leadTimeLine]),
    '',
    copy.signOff,
  ].join('\n');

  // Names and SKUs are typed by people in the admin and reach a buyer's
  // inbox as markup, so every one of them is escaped.
  const items = order.lines
    .map(
      (line) =>
        `<li>${escapeHtml(line.name)} (${escapeHtml(line.sku)}) × ${
          line.quantity
        } — ${escapeHtml(money(line.unitPriceMinor * line.quantity))}</li>`,
    )
    .join('');

  const html = layout(
    subject,
    `<p>${escapeHtml(copy.confirmIntro)}</p>
<h2 style="font-size:16px;">${escapeHtml(copy.itemsHeading)}</h2>
<ul>${items}</ul>
<p><strong>${escapeHtml(copy.totalLabel)}: ${escapeHtml(
      money(order.totalMinor),
    )}</strong></p>
${leadTimeLine === null ? '' : `<p>${escapeHtml(leadTimeLine)}</p>`}
<p style="color:#525252;font-size:14px;">${escapeHtml(copy.signOff)}</p>`,
  );

  return { subject, text, html };
}

/** The notice sent when an order ships. */
export function shippingNotificationEmail(input: {
  readonly orderNo: string;
  readonly locale: string;
  readonly trackingNo: string | null;
}): EmailContent {
  const copy = COPY[languageOf(input.locale)] ?? ENGLISH;
  const subject = copy.shipSubject(input.orderNo);

  const text = [
    copy.shipIntro,
    ...(input.trackingNo === null
      ? []
      : ['', `${copy.trackingLabel}: ${input.trackingNo}`]),
    '',
    copy.signOff,
  ].join('\n');

  const html = layout(
    subject,
    `<p>${escapeHtml(copy.shipIntro)}</p>
${
  input.trackingNo === null
    ? ''
    : `<p><strong>${escapeHtml(copy.trackingLabel)}:</strong> ${escapeHtml(
        input.trackingNo,
      )}</p>`
}
<p style="color:#525252;font-size:14px;">${escapeHtml(copy.signOff)}</p>`,
  );

  return { subject, text, html };
}
