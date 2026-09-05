import type { EmailContent } from "./templates";

/**
 * The Workers binding shape for Cloudflare Email Sending.
 * A binding rather than the REST API, so the Worker holds no API token.
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
 * Send one transactional email.
 *
 * Never throws. A notification that cannot be delivered must not roll back
 * placing or shipping an order — the money has moved and the order has changed,
 * and failing the whole operation over a failed notice is worse for the buyer
 * than the missing email. Callers log or alert on the returned result.
 *
 * The recipient address stays out of the logs.
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
      // Both parts are required: HTML alone renders blank in some clients and
      // pushes up the spam score
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
