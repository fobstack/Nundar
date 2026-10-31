/**
 * The emails an order sends.
 *
 * The buyer's four (design §20, D17): payment confirmed, shipped, refunded,
 * and cancelled by the seller. Each is written in the language the order was
 * placed in. The seller's (D16): a new order, an order paid for after its
 * stock had gone, and a payment that has to be refunded — in English, as
 * the inquiry's is, since they are read in the admin's language.
 *
 * Each carries a plain-text part beside the HTML: HTML alone renders blank
 * in some clients and raises the spam score. Every value that reached the
 * shop from a person — a name, an address, a product's name typed in the
 * admin — is escaped on its way into the HTML.
 *
 * These build the content only. Sending is Mallok's `ctx.sendEmail`.
 */

import { escapeHtml } from 'mallok/worker';
import type { Currency } from './currency.js';
import { formatMoney } from './money.js';
import type { OrderDetail, OrderLine, ShippingAddress } from './orders.js';
import { countryName } from './shipping.js';

export interface EmailContent {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

interface Copy {
  readonly confirmSubject: (orderNo: string) => string;
  readonly confirmIntro: string;
  readonly itemsHeading: string;
  readonly subtotalLabel: string;
  readonly shippingLabel: string;
  readonly taxLabel: string;
  readonly totalLabel: string;
  readonly addressHeading: string;
  readonly leadTime: (days: number) => string;
  readonly viewOrder: string;
  readonly shipSubject: (orderNo: string) => string;
  readonly shipIntro: string;
  readonly trackingLabel: string;
  readonly carrierLabel: string;
  readonly refundSubject: (orderNo: string) => string;
  readonly refundIntro: (amount: string) => string;
  readonly refundTiming: string;
  readonly cancelSubject: (orderNo: string) => string;
  readonly cancelIntro: string;
  readonly signOff: string;
}

const ENGLISH: Copy = {
  confirmSubject: (orderNo) => `Order ${orderNo} confirmed`,
  confirmIntro: 'Thank you for your order. We have received your payment.',
  itemsHeading: 'Items',
  subtotalLabel: 'Subtotal',
  shippingLabel: 'Shipping',
  taxLabel: 'Tax',
  totalLabel: 'Total',
  addressHeading: 'Shipping to',
  leadTime: (days) => `Expected to ship within ${days} business days.`,
  viewOrder: 'See your order',
  shipSubject: (orderNo) => `Order ${orderNo} has shipped`,
  shipIntro: 'Your order is on its way.',
  trackingLabel: 'Tracking number',
  carrierLabel: 'Carrier',
  refundSubject: (orderNo) => `Order ${orderNo} refunded`,
  refundIntro: (amount) =>
    `We have refunded ${amount} to the payment method you used.`,
  refundTiming:
    'Depending on your bank, it can take a few business days to appear.',
  cancelSubject: (orderNo) => `Order ${orderNo} cancelled`,
  cancelIntro: 'Your order has been cancelled. You have not been charged.',
  signOff: 'If you have any questions, simply reply to this email.',
};

const COPY: Readonly<Record<string, Copy>> = {
  en: ENGLISH,
  de: {
    confirmSubject: (orderNo) => `Bestellung ${orderNo} bestätigt`,
    confirmIntro:
      'Vielen Dank für Ihre Bestellung. Ihre Zahlung ist bei uns eingegangen.',
    itemsHeading: 'Artikel',
    subtotalLabel: 'Zwischensumme',
    shippingLabel: 'Versand',
    taxLabel: 'Steuer',
    totalLabel: 'Gesamt',
    addressHeading: 'Lieferadresse',
    leadTime: (days) =>
      `Voraussichtlicher Versand innerhalb von ${days} Werktagen.`,
    viewOrder: 'Bestellung ansehen',
    shipSubject: (orderNo) => `Bestellung ${orderNo} wurde versandt`,
    shipIntro: 'Ihre Bestellung ist unterwegs.',
    trackingLabel: 'Sendungsnummer',
    carrierLabel: 'Versanddienstleister',
    refundSubject: (orderNo) => `Bestellung ${orderNo} erstattet`,
    refundIntro: (amount) =>
      `Wir haben ${amount} auf Ihr Zahlungsmittel zurückerstattet.`,
    refundTiming:
      'Je nach Bank kann es einige Werktage dauern, bis der Betrag sichtbar ist.',
    cancelSubject: (orderNo) => `Bestellung ${orderNo} storniert`,
    cancelIntro:
      'Ihre Bestellung wurde storniert. Ihnen wurde nichts berechnet.',
    signOff: 'Bei Fragen antworten Sie einfach auf diese E-Mail.',
  },
  fr: {
    confirmSubject: (orderNo) => `Commande ${orderNo} confirmée`,
    confirmIntro:
      'Merci pour votre commande. Nous avons bien reçu votre paiement.',
    itemsHeading: 'Articles',
    subtotalLabel: 'Sous-total',
    shippingLabel: 'Livraison',
    taxLabel: 'Taxes',
    totalLabel: 'Total',
    addressHeading: 'Adresse de livraison',
    leadTime: (days) => `Expédition prévue sous ${days} jours ouvrés.`,
    viewOrder: 'Voir votre commande',
    shipSubject: (orderNo) => `Commande ${orderNo} expédiée`,
    shipIntro: 'Votre commande est en route.',
    trackingLabel: 'Numéro de suivi',
    carrierLabel: 'Transporteur',
    refundSubject: (orderNo) => `Commande ${orderNo} remboursée`,
    refundIntro: (amount) =>
      `Nous avons remboursé ${amount} sur le moyen de paiement utilisé.`,
    refundTiming:
      'Selon votre banque, le remboursement peut mettre quelques jours ouvrés à apparaître.',
    cancelSubject: (orderNo) => `Commande ${orderNo} annulée`,
    cancelIntro: 'Votre commande a été annulée. Aucun montant n’a été débité.',
    signOff: 'Pour toute question, répondez simplement à cet e-mail.',
  },
  es: {
    confirmSubject: (orderNo) => `Pedido ${orderNo} confirmado`,
    confirmIntro: 'Gracias por su pedido. Hemos recibido su pago.',
    itemsHeading: 'Artículos',
    subtotalLabel: 'Subtotal',
    shippingLabel: 'Envío',
    taxLabel: 'Impuestos',
    totalLabel: 'Total',
    addressHeading: 'Dirección de envío',
    leadTime: (days) => `Envío previsto en ${days} días hábiles.`,
    viewOrder: 'Ver su pedido',
    shipSubject: (orderNo) => `Pedido ${orderNo} enviado`,
    shipIntro: 'Su pedido está en camino.',
    trackingLabel: 'Número de seguimiento',
    carrierLabel: 'Transportista',
    refundSubject: (orderNo) => `Pedido ${orderNo} reembolsado`,
    refundIntro: (amount) =>
      `Hemos reembolsado ${amount} al medio de pago que utilizó.`,
    refundTiming: 'Según su banco, puede tardar unos días hábiles en aparecer.',
    cancelSubject: (orderNo) => `Pedido ${orderNo} cancelado`,
    cancelIntro: 'Su pedido ha sido cancelado. No se le ha cobrado nada.',
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

const SIGN_OFF_STYLE = 'color:#525252;font-size:14px;';

/** A link to an absolute https address, or nothing. */
function linkHtml(href: string | undefined, label: string): string {
  if (href === undefined || !/^https?:\/\//.test(href)) {
    return '';
  }
  return `<p><a href="${escapeHtml(href)}">${escapeHtml(label)}</a></p>`;
}

/** An address, one line a part, the country by name. */
function addressLines(
  address: Partial<ShippingAddress>,
  company: string,
  language: string,
): string[] {
  const cityLine = [address.postalCode, address.city]
    .filter((part) => part !== undefined && part !== '')
    .join(' ');
  return [
    address.recipient,
    company,
    address.line1,
    address.line2,
    cityLine,
    address.state,
    address.country === undefined || address.country === ''
      ? undefined
      : countryName(address.country, language),
  ].filter((line): line is string => line !== undefined && line !== '');
}

function lineText(line: OrderLine, money: (minor: number) => string): string {
  return `- ${line.name} (${line.sku}) × ${line.quantity} — ${money(
    line.unitPriceMinor * line.quantity,
  )}`;
}

function lineHtml(line: OrderLine, money: (minor: number) => string): string {
  return `<li>${escapeHtml(line.name)} (${escapeHtml(line.sku)}) × ${
    line.quantity
  } — ${escapeHtml(money(line.unitPriceMinor * line.quantity))}</li>`;
}

type ConfirmedOrder = Pick<
  OrderDetail,
  'orderNo' | 'currency' | 'totalMinor' | 'locale' | 'lines' | 'leadTimeDaysMax'
> &
  Partial<
    Pick<
      OrderDetail,
      | 'subtotalMinor'
      | 'shippingMinor'
      | 'taxMinor'
      | 'shippingAddress'
      | 'company'
    >
  >;

/**
 * The confirmation sent once, when an order's payment is confirmed. With the
 * order's own link, when there is one, so that the buyer can follow it.
 */
export function orderConfirmationEmail(
  order: ConfirmedOrder,
  orderUrl?: string,
): EmailContent {
  const language = languageOf(order.locale);
  const copy = COPY[language] ?? ENGLISH;
  const money = (minor: number) => formatMoney(minor, order.currency, language);

  const subject = copy.confirmSubject(order.orderNo);
  const leadTimeLine =
    order.leadTimeDaysMax === null
      ? null
      : copy.leadTime(order.leadTimeDaysMax);
  // The parts of the total, when the order says what they are.
  const breakdown: [string, number][] =
    order.subtotalMinor === undefined
      ? []
      : [
          [copy.subtotalLabel, order.subtotalMinor],
          [copy.shippingLabel, order.shippingMinor ?? 0],
          ...((order.taxMinor ?? 0) > 0
            ? ([[copy.taxLabel, order.taxMinor ?? 0]] as [string, number][])
            : []),
        ];
  const address =
    order.shippingAddress === undefined
      ? []
      : addressLines(order.shippingAddress, order.company ?? '', language);

  const text = [
    copy.confirmIntro,
    '',
    `${copy.itemsHeading}:`,
    ...order.lines.map((line) => lineText(line, money)),
    '',
    ...breakdown.map(([label, minor]) => `${label}: ${money(minor)}`),
    `${copy.totalLabel}: ${money(order.totalMinor)}`,
    ...(leadTimeLine === null ? [] : ['', leadTimeLine]),
    ...(address.length === 0
      ? []
      : ['', `${copy.addressHeading}:`, ...address]),
    ...(orderUrl === undefined ? [] : ['', `${copy.viewOrder}: ${orderUrl}`]),
    '',
    copy.signOff,
  ].join('\n');

  const html = layout(
    subject,
    `<p>${escapeHtml(copy.confirmIntro)}</p>
<h2 style="font-size:16px;">${escapeHtml(copy.itemsHeading)}</h2>
<ul>${order.lines.map((line) => lineHtml(line, money)).join('')}</ul>
${breakdown
  .map(
    ([label, minor]) =>
      `<p style="margin:0;">${escapeHtml(label)}: ${escapeHtml(money(minor))}</p>`,
  )
  .join('\n')}
<p><strong>${escapeHtml(copy.totalLabel)}: ${escapeHtml(
      money(order.totalMinor),
    )}</strong></p>
${leadTimeLine === null ? '' : `<p>${escapeHtml(leadTimeLine)}</p>`}
${
  address.length === 0
    ? ''
    : `<h2 style="font-size:16px;">${escapeHtml(copy.addressHeading)}</h2>
<p>${address.map(escapeHtml).join('<br>')}</p>`
}
${linkHtml(orderUrl, copy.viewOrder)}
<p style="${SIGN_OFF_STYLE}">${escapeHtml(copy.signOff)}</p>`,
  );

  return { subject, text, html };
}

/** The notice sent when an order ships. */
export function shippingNotificationEmail(input: {
  readonly orderNo: string;
  readonly locale: string;
  readonly trackingNo: string | null;
  readonly carrier?: string | null;
  readonly orderUrl?: string;
}): EmailContent {
  const copy = COPY[languageOf(input.locale)] ?? ENGLISH;
  const subject = copy.shipSubject(input.orderNo);
  const carrier =
    input.carrier === undefined ||
    input.carrier === null ||
    input.carrier === ''
      ? null
      : input.carrier;

  const text = [
    copy.shipIntro,
    ...(carrier === null ? [] : ['', `${copy.carrierLabel}: ${carrier}`]),
    ...(input.trackingNo === null
      ? []
      : [
          ...(carrier === null ? [''] : []),
          `${copy.trackingLabel}: ${input.trackingNo}`,
        ]),
    ...(input.orderUrl === undefined
      ? []
      : ['', `${copy.viewOrder}: ${input.orderUrl}`]),
    '',
    copy.signOff,
  ].join('\n');

  const html = layout(
    subject,
    `<p>${escapeHtml(copy.shipIntro)}</p>
${
  carrier === null
    ? ''
    : `<p><strong>${escapeHtml(copy.carrierLabel)}:</strong> ${escapeHtml(
        carrier,
      )}</p>`
}
${
  input.trackingNo === null
    ? ''
    : `<p><strong>${escapeHtml(copy.trackingLabel)}:</strong> ${escapeHtml(
        input.trackingNo,
      )}</p>`
}
${linkHtml(input.orderUrl, copy.viewOrder)}
<p style="${SIGN_OFF_STYLE}">${escapeHtml(copy.signOff)}</p>`,
  );

  return { subject, text, html };
}

/** The notice sent once an order's payment has been refunded. */
export function refundNotificationEmail(input: {
  readonly orderNo: string;
  readonly locale: string;
  readonly currency: Currency;
  readonly totalMinor: number;
  readonly orderUrl?: string;
}): EmailContent {
  const language = languageOf(input.locale);
  const copy = COPY[language] ?? ENGLISH;
  const subject = copy.refundSubject(input.orderNo);
  const intro = copy.refundIntro(
    formatMoney(input.totalMinor, input.currency, language),
  );

  const text = [
    intro,
    copy.refundTiming,
    ...(input.orderUrl === undefined
      ? []
      : ['', `${copy.viewOrder}: ${input.orderUrl}`]),
    '',
    copy.signOff,
  ].join('\n');
  const html = layout(
    subject,
    `<p>${escapeHtml(intro)}</p>
<p>${escapeHtml(copy.refundTiming)}</p>
${linkHtml(input.orderUrl, copy.viewOrder)}
<p style="${SIGN_OFF_STYLE}">${escapeHtml(copy.signOff)}</p>`,
  );
  return { subject, text, html };
}

/** The notice sent when the seller cancels an order that was never paid. */
export function cancellationEmail(input: {
  readonly orderNo: string;
  readonly locale: string;
}): EmailContent {
  const copy = COPY[languageOf(input.locale)] ?? ENGLISH;
  const subject = copy.cancelSubject(input.orderNo);
  const text = [copy.cancelIntro, '', copy.signOff].join('\n');
  const html = layout(
    subject,
    `<p>${escapeHtml(copy.cancelIntro)}</p>
<p style="${SIGN_OFF_STYLE}">${escapeHtml(copy.signOff)}</p>`,
  );
  return { subject, text, html };
}

type SellerOrder = Pick<
  OrderDetail,
  | 'orderNo'
  | 'currency'
  | 'subtotalMinor'
  | 'shippingMinor'
  | 'taxMinor'
  | 'totalMinor'
  | 'email'
  | 'company'
  | 'taxId'
  | 'shippingZone'
  | 'shippingAddress'
  | 'lines'
>;

/** The order, as the seller's notices print it: lines, sums, buyer, address. */
function sellerSummary(order: SellerOrder): { text: string[]; html: string } {
  const money = (minor: number) => formatMoney(minor, order.currency, 'en');
  const address = addressLines(order.shippingAddress, order.company, 'en');
  const facts: [string, string][] = [
    ['Subtotal', money(order.subtotalMinor)],
    ['Shipping', money(order.shippingMinor)],
    ...(order.taxMinor > 0
      ? ([['Tax', money(order.taxMinor)]] as [string, string][])
      : []),
    ['Total', money(order.totalMinor)],
    ['Buyer', order.email],
    ...(order.taxId === ''
      ? []
      : ([['Tax number', order.taxId]] as [string, string][])),
    ...(order.shippingZone === ''
      ? []
      : ([['Shipping zone', order.shippingZone]] as [string, string][])),
  ];
  return {
    text: [
      'Items:',
      ...order.lines.map((line) => lineText(line, money)),
      '',
      ...facts.map(([label, value]) => `${label}: ${value}`),
      ...(address.length === 0 ? [] : ['', 'Ship to:', ...address]),
    ],
    html: `<ul>${order.lines.map((line) => lineHtml(line, money)).join('')}</ul>
${facts
  .map(
    ([label, value]) =>
      `<p style="margin:0;"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`,
  )
  .join('\n')}
${
  address.length === 0
    ? ''
    : `<h2 style="font-size:16px;">Ship to</h2>
<p>${address.map(escapeHtml).join('<br>')}</p>`
}`,
  };
}

/** To the seller, when an order has been paid for. Answered to the buyer. */
export function sellerNewOrderEmail(order: SellerOrder): EmailContent {
  const money = formatMoney(order.totalMinor, order.currency, 'en');
  const subject = `New order ${order.orderNo} — ${money}`;
  const summary = sellerSummary(order);
  const intro =
    'An order has been paid for. It is in the admin under Shop → Orders.';
  return {
    subject,
    text: [intro, '', ...summary.text].join('\n'),
    html: layout(subject, `<p>${escapeHtml(intro)}</p>\n${summary.html}`),
  };
}

/** To the seller, when an order was paid for after its stock had gone. */
export function sellerOversoldEmail(order: SellerOrder): EmailContent {
  const subject = `Order ${order.orderNo} was paid for, and the stock had gone`;
  const intro =
    'The payment went through after the stock for this order had been sold. Nothing has been shipped or taken from stock. In the admin, under Shop → Orders, either refund it, or restock and fulfil it.';
  const summary = sellerSummary(order);
  return {
    subject,
    text: [intro, '', ...summary.text].join('\n'),
    html: layout(subject, `<p>${escapeHtml(intro)}</p>\n${summary.html}`),
  };
}

/** Why a payment could not be kept, as the seller is told it. */
export type RefusedBecause =
  /** The order had been cancelled when the payment came in. */
  | 'cancelled'
  /** Another payment had settled the order already. */
  | 'already_paid'
  /** The payment did not come to the order's total in its currency. */
  | 'amount_mismatch';

const REFUSED_REASON: Readonly<Record<RefusedBecause, string>> = {
  cancelled: 'the order had been cancelled when the payment came in',
  already_paid: 'another payment had already settled the order',
  amount_mismatch:
    "the payment did not come to the order's total in its currency",
};

/** To the seller, when a payment came in that the shop could not keep. */
export function sellerRefundOwedEmail(input: {
  readonly orderNo: string;
  readonly paymentIntentId: string;
  readonly because: RefusedBecause;
}): EmailContent {
  const subject = `A payment for order ${input.orderNo} has to be refunded`;
  const lines = [
    `Stripe took a payment for order ${input.orderNo} that the shop could not keep: ${REFUSED_REASON[input.because]}. Nothing was shipped and no stock was taken.`,
    `Payment: ${input.paymentIntentId}`,
    'Refund it in the admin, under Shop → Refused payments, so that the shop records the refund.',
  ];
  return {
    subject,
    text: lines.join('\n\n'),
    html: layout(
      subject,
      lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('\n'),
    ),
  };
}
