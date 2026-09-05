import { describe, expect, it } from "vitest";
import {
  orderConfirmationEmail,
  shippingNotificationEmail,
} from "@/lib/email/templates";

const ORDER = {
  orderNo: "KT-260904-AB12CD",
  currency: "USD" as const,
  totalMinor: 99_000,
  locale: "en" as const,
  lines: [
    {
      nameSnapshot: "Stainless Steel Ball Valve DN50",
      skuSnapshot: "BV-316L-DN50-NPT",
      quantity: 10,
      unitPriceMinor: 9900,
    },
  ],
  leadTimeDaysMax: 20,
};

describe("orderConfirmationEmail", () => {
  const mail = orderConfirmationEmail(ORDER);

  it("puts the order number in the subject so replies are traceable", () => {
    expect(mail.subject).toContain("KT-260904-AB12CD");
  });

  it("always ships a plain-text part alongside the HTML", () => {
    // 只发 HTML 会被部分客户端显示为空白，也会拉高垃圾邮件评分
    expect(mail.text.length).toBeGreaterThan(0);
    expect(mail.html.length).toBeGreaterThan(0);
  });

  it("lists each line with quantity and formatted money", () => {
    expect(mail.text).toContain("Stainless Steel Ball Valve DN50");
    expect(mail.text).toContain("BV-316L-DN50-NPT");
    expect(mail.text).toContain("10");
    expect(mail.text).toContain("$990.00");
  });

  it("states the total in the order's own currency", () => {
    expect(mail.text).toContain("$990.00");
  });

  it("tells the buyer the expected lead time", () => {
    expect(mail.text).toContain("20");
  });

  it("writes in the language the order was placed in", () => {
    const german = orderConfirmationEmail({ ...ORDER, locale: "de" });
    expect(german.subject).toMatch(/Bestellung/i);

    const french = orderConfirmationEmail({ ...ORDER, locale: "fr" });
    expect(french.subject).toMatch(/commande/i);

    const spanish = orderConfirmationEmail({ ...ORDER, locale: "es" });
    expect(spanish.subject).toMatch(/pedido/i);
  });

  it("escapes HTML in product names so a crafted name cannot inject markup", () => {
    const nasty = orderConfirmationEmail({
      ...ORDER,
      lines: [
        {
          ...ORDER.lines[0],
          nameSnapshot: '<script>alert("x")</script>',
        },
      ],
    });

    expect(nasty.html).not.toContain("<script>");
    expect(nasty.html).toContain("&lt;script&gt;");
  });

  it("formats money in the recipient's locale conventions", () => {
    const german = orderConfirmationEmail({
      ...ORDER,
      locale: "de",
      currency: "EUR",
    });
    expect(german.text).toContain("990,00");
  });
});

describe("shippingNotificationEmail", () => {
  const mail = shippingNotificationEmail({
    orderNo: "KT-260904-AB12CD",
    locale: "en",
    trackingNo: "TRACK123456",
  });

  it("carries the tracking number in both parts", () => {
    expect(mail.text).toContain("TRACK123456");
    expect(mail.html).toContain("TRACK123456");
  });

  it("names the order in the subject", () => {
    expect(mail.subject).toContain("KT-260904-AB12CD");
  });

  it("omits the tracking section when there is no tracking number", () => {
    const without = shippingNotificationEmail({
      orderNo: "KT-1",
      locale: "en",
      trackingNo: null,
    });

    expect(without.text).not.toMatch(/tracking number:\s*$/im);
    expect(without.text.length).toBeGreaterThan(0);
  });

  it("localises the subject", () => {
    const german = shippingNotificationEmail({
      orderNo: "KT-1",
      locale: "de",
      trackingNo: "T1",
    });
    expect(german.subject).toMatch(/versandt|versand/i);
  });
});
