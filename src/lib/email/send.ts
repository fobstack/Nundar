import type { EmailContent } from "./templates";

/**
 * Cloudflare Email Sending 的 Workers 绑定形态。
 * 用绑定而非 REST API：不需要在 Worker 里保管 API token。
 */
export type EmailBinding = {
  send(message: {
    to: string;
    from: { email: string; name?: string };
    subject: string;
    html: string;
    text: string;
    replyTo?: string;
  }): Promise<unknown>;
};

export type SendResult = { ok: true } | { ok: false; reason: string };

/**
 * 发一封事务邮件。
 *
 * 失败不抛出：邮件发不出去不该让下单或发货流程回滚——货已经付了、订单已经改了，
 * 因为通知失败就整体失败对用户更糟。调用方按返回值记日志或告警即可。
 *
 * 日志里不写收件地址，避免 PII 进日志。
 */
export async function sendTransactionalEmail(
  binding: EmailBinding | undefined,
  input: {
    to: string;
    fromAddress: string;
    fromName?: string;
    content: EmailContent;
  },
): Promise<SendResult> {
  if (!binding) {
    return { ok: false, reason: "Email binding is not configured" };
  }
  if (!input.to || !input.fromAddress) {
    return { ok: false, reason: "Missing sender or recipient address" };
  }

  try {
    await binding.send({
      to: input.to,
      from: { email: input.fromAddress, name: input.fromName },
      subject: input.content.subject,
      // 两个版本都要有：只发 HTML 会在部分客户端显示空白，也会拉高垃圾邮件评分
      html: input.content.html,
      text: input.content.text,
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
