import type { Currency } from "@/config/currency";
import type { Locale } from "@/config/locales";
import { formatMoney } from "@/lib/money";

export type EmailContent = {
  subject: string;
  text: string;
  html: string;
};

type OrderLine = {
  nameSnapshot: string;
  skuSnapshot: string;
  quantity: number;
  unitPriceMinor: number;
};

/** Product names come from the database and must be escaped before reaching HTML */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type Copy = {
  confirmSubject: (orderNo: string) => string;
  confirmIntro: string;
  itemsHeading: string;
  totalLabel: string;
  leadTime: (days: number) => string;
  shipSubject: (orderNo: string) => string;
  shipIntro: string;
  trackingLabel: string;
  signOff: string;
};

const COPY: Record<Locale, Copy> = {
  en: {
    confirmSubject: (orderNo) => `Order ${orderNo} confirmed`,
    confirmIntro: "Thank you for your order. We have received your payment.",
    itemsHeading: "Items",
    totalLabel: "Total",
    leadTime: (days) => `Expected to ship within ${days} business days.`,
    shipSubject: (orderNo) => `Order ${orderNo} has shipped`,
    shipIntro: "Your order is on its way.",
    trackingLabel: "Tracking number",
    signOff: "If you have any questions, simply reply to this email.",
  },
  de: {
    confirmSubject: (orderNo) => `Bestellung ${orderNo} bestätigt`,
    confirmIntro:
      "Vielen Dank für Ihre Bestellung. Ihre Zahlung ist bei uns eingegangen.",
    itemsHeading: "Artikel",
    totalLabel: "Gesamt",
    leadTime: (days) =>
      `Voraussichtlicher Versand innerhalb von ${days} Werktagen.`,
    shipSubject: (orderNo) => `Bestellung ${orderNo} wurde versandt`,
    shipIntro: "Ihre Bestellung ist unterwegs.",
    trackingLabel: "Sendungsnummer",
    signOff: "Bei Fragen antworten Sie einfach auf diese E-Mail.",
  },
  fr: {
    confirmSubject: (orderNo) => `Commande ${orderNo} confirmée`,
    confirmIntro:
      "Merci pour votre commande. Nous avons bien reçu votre paiement.",
    itemsHeading: "Articles",
    totalLabel: "Total",
    leadTime: (days) => `Expédition prévue sous ${days} jours ouvrés.`,
    shipSubject: (orderNo) => `Commande ${orderNo} expédiée`,
    shipIntro: "Votre commande est en route.",
    trackingLabel: "Numéro de suivi",
    signOff: "Pour toute question, répondez simplement à cet e-mail.",
  },
  es: {
    confirmSubject: (orderNo) => `Pedido ${orderNo} confirmado`,
    confirmIntro: "Gracias por su pedido. Hemos recibido su pago.",
    itemsHeading: "Artículos",
    totalLabel: "Total",
    leadTime: (days) => `Envío previsto en ${days} días hábiles.`,
    shipSubject: (orderNo) => `Pedido ${orderNo} enviado`,
    shipIntro: "Su pedido está en camino.",
    trackingLabel: "Número de seguimiento",
    signOff: "Si tiene alguna pregunta, responda a este correo.",
  },
};

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html>
<body style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;line-height:1.6;color:#171717;">
<h1 style="font-size:20px;">${escapeHtml(title)}</h1>
${bodyHtml}
</body>
</html>`;
}

export function orderConfirmationEmail(input: {
  orderNo: string;
  currency: Currency;
  totalMinor: number;
  locale: Locale;
  lines: OrderLine[];
  leadTimeDaysMax?: number | null;
}): EmailContent {
  const copy = COPY[input.locale];
  const money = (minor: number) =>
    formatMoney(minor, input.currency, input.locale);

  const textLines = input.lines.map(
    (line) =>
      `- ${line.nameSnapshot} (${line.skuSnapshot}) × ${line.quantity} — ${money(
        line.unitPriceMinor * line.quantity,
      )}`,
  );

  const htmlLines = input.lines.map(
    (line) =>
      `<li>${escapeHtml(line.nameSnapshot)} (${escapeHtml(
        line.skuSnapshot,
      )}) × ${line.quantity} — ${escapeHtml(
        money(line.unitPriceMinor * line.quantity),
      )}</li>`,
  );

  const leadTimeLine = input.leadTimeDaysMax
    ? copy.leadTime(input.leadTimeDaysMax)
    : null;

  const text = [
    copy.confirmIntro,
    "",
    `${copy.itemsHeading}:`,
    ...textLines,
    "",
    `${copy.totalLabel}: ${money(input.totalMinor)}`,
    ...(leadTimeLine ? ["", leadTimeLine] : []),
    "",
    copy.signOff,
  ].join("\n");

  const html = layout(
    copy.confirmSubject(input.orderNo),
    `<p>${escapeHtml(copy.confirmIntro)}</p>
<h2 style="font-size:16px;">${escapeHtml(copy.itemsHeading)}</h2>
<ul>${htmlLines.join("")}</ul>
<p><strong>${escapeHtml(copy.totalLabel)}: ${escapeHtml(
      money(input.totalMinor),
    )}</strong></p>
${leadTimeLine ? `<p>${escapeHtml(leadTimeLine)}</p>` : ""}
<p style="color:#525252;font-size:14px;">${escapeHtml(copy.signOff)}</p>`,
  );

  return { subject: copy.confirmSubject(input.orderNo), text, html };
}

export function shippingNotificationEmail(input: {
  orderNo: string;
  locale: Locale;
  trackingNo: string | null;
}): EmailContent {
  const copy = COPY[input.locale];

  const text = [
    copy.shipIntro,
    ...(input.trackingNo
      ? ["", `${copy.trackingLabel}: ${input.trackingNo}`]
      : []),
    "",
    copy.signOff,
  ].join("\n");

  const html = layout(
    copy.shipSubject(input.orderNo),
    `<p>${escapeHtml(copy.shipIntro)}</p>
${
  input.trackingNo
    ? `<p><strong>${escapeHtml(copy.trackingLabel)}:</strong> ${escapeHtml(
        input.trackingNo,
      )}</p>`
    : ""
}
<p style="color:#525252;font-size:14px;">${escapeHtml(copy.signOff)}</p>`,
  );

  return { subject: copy.shipSubject(input.orderNo), text, html };
}
