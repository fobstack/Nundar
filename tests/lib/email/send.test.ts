import { describe, expect, it } from "vitest";
import { sendTransactionalEmail, type EmailBinding } from "@/lib/email/send";

const CONTENT = {
  subject: "Order ND-1 confirmed",
  text: "plain",
  html: "<p>html</p>",
};

function recordingBinding(behaviour?: () => Promise<unknown>) {
  const sent: unknown[] = [];
  const binding: EmailBinding = {
    async send(message) {
      sent.push(message);
      if (behaviour) {
        return behaviour();
      }
      return { ok: true };
    },
  };
  return { binding, sent };
}

describe("sendTransactionalEmail", () => {
  it("sends both html and text parts", async () => {
    const { binding, sent } = recordingBinding();

    const result = await sendTransactionalEmail(binding, {
      to: "buyer@example.com",
      fromAddress: "orders@shop.example",
      fromName: "Nundar",
      content: CONTENT,
    });

    expect(result.ok).toBe(true);
    expect(sent[0]).toMatchObject({
      to: "buyer@example.com",
      from: { email: "orders@shop.example", name: "Nundar" },
      subject: CONTENT.subject,
      html: CONTENT.html,
      text: CONTENT.text,
    });
  });

  it("reports a missing binding instead of throwing", async () => {
    const result = await sendTransactionalEmail(undefined, {
      to: "buyer@example.com",
      fromAddress: "orders@shop.example",
      content: CONTENT,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/not configured/i);
  });

  it("reports a missing recipient rather than sending to nowhere", async () => {
    const { binding, sent } = recordingBinding();

    const result = await sendTransactionalEmail(binding, {
      to: "",
      fromAddress: "orders@shop.example",
      content: CONTENT,
    });

    expect(result.ok).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it("swallows a provider failure so the order flow is not rolled back", async () => {
    const { binding } = recordingBinding(async () => {
      throw new Error("domain not verified");
    });

    const result = await sendTransactionalEmail(binding, {
      to: "buyer@example.com",
      fromAddress: "orders@shop.example",
      content: CONTENT,
    });

    // 货已付、订单已改，不能因为通知发不出去就整体失败
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/domain not verified/);
  });
});
