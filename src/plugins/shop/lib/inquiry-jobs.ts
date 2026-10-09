/**
 * What an inquiry owes after it is stored: an email to the seller, and one
 * to the buyer when the shop is set to send it.
 *
 * It is a job, queued in the batch that stores the inquiry, so the emails
 * are owed exactly when the inquiry exists. Mallok runs a job at least once
 * and may run it twice; each email is marked on the inquiry once it has been
 * handed to Mallok, and a second run sends only what is not marked.
 */

import type { PluginContext } from 'mallok/worker';
import { EMAIL_PATTERN, readInquiry } from './inquiries.js';
import {
  inquiryAcknowledgementEmail,
  inquiryNotificationEmail,
} from './inquiry-email.js';

/** The job's name, as `definePlugin` and `ctx.enqueueStatement` know it. */
export const INQUIRY_EMAILS_JOB = 'inquiry_emails';

export interface InquirySettings {
  /** Where the seller is told; '' when nowhere, or not an address. */
  readonly recipient: string;
  /** Whether the buyer is told their request arrived. */
  readonly acknowledge: boolean;
}

export function inquirySettings(
  settings: Readonly<Record<string, unknown>>,
): InquirySettings {
  const recipient =
    typeof settings.inquiry_recipient === 'string'
      ? settings.inquiry_recipient.trim()
      : '';
  return {
    recipient: EMAIL_PATTERN.test(recipient) ? recipient : '',
    acknowledge: settings.inquiry_acknowledge === true,
  };
}

/** Whether an inquiry stored under these settings has any email to send. */
export function owesEmail(settings: InquirySettings): boolean {
  return settings.recipient !== '' || settings.acknowledge;
}

function inquiryIdOf(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }
  const { inquiryId } = payload as { inquiryId?: unknown };
  return typeof inquiryId === 'string' ? inquiryId : null;
}

function markStatement(
  db: D1Database,
  column: 'notified_at' | 'acknowledged_at',
  id: string,
  now: Date,
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE p_shop_inquiry SET ${column} = ? WHERE id = ? AND ${column} IS NULL`,
    )
    .bind(now.toISOString(), id);
}

/**
 * Sends what an inquiry still owes.
 *
 * An inquiry that is not there owes nothing: the job is queued beside a
 * conditional write, and is there even when the write stored no inquiry —
 * one over the visitor's limit, or the second of two sent at once. So does
 * one that was deleted before its job ran.
 *
 * A failure to hand an email to Mallok throws, and Mallok runs the job
 * again later; what was already handed over is marked and is not repeated.
 */
export async function sendInquiryEmails(
  payload: unknown,
  ctx: PluginContext,
  now: Date = new Date(),
): Promise<void> {
  const id = inquiryIdOf(payload);
  if (id === null) {
    return;
  }
  const inquiry = await readInquiry(ctx.db, id);
  if (inquiry === null) {
    return;
  }
  const settings = inquirySettings(ctx.settings);

  if (settings.recipient !== '' && inquiry.notifiedAt === null) {
    await ctx.sendEmail({
      to: settings.recipient,
      ...inquiryNotificationEmail(inquiry, ctx.site.name),
    });
    await markStatement(ctx.db, 'notified_at', id, now).run();
  }

  // Nobody is written to about what the seller has called spam.
  if (
    settings.acknowledge &&
    inquiry.acknowledgedAt === null &&
    inquiry.status !== 'spam'
  ) {
    await ctx.sendEmail({
      to: inquiry.email,
      ...inquiryAcknowledgementEmail(inquiry),
    });
    await markStatement(ctx.db, 'acknowledged_at', id, now).run();
  }
}
