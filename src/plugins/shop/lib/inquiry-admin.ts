/**
 * What the admin does with inquiries: mark them, export them, delete them.
 *
 * Mallok lists the inquiries and their lines itself, from the panel the
 * manifest declares. These are the panel's actions; each receives the ids
 * of the rows that were ticked.
 */

import type { PluginContext } from 'mallok/worker';
import {
  deleteInquiriesStatements,
  type InquiryStatus,
  inquiriesCsv,
  markInquiriesStatement,
  readInquiries,
} from './inquiries.js';

/** The most rows one action changes, as in Mallok's own inquiry panel. */
const ACTION_LIMIT = 100;

/** The most inquiries one export holds. */
const EXPORT_LIMIT = 1000;

export async function markInquiries(
  ids: readonly string[],
  ctx: PluginContext,
  status: InquiryStatus,
  now: Date = new Date(),
): Promise<undefined> {
  const bounded = ids.slice(0, ACTION_LIMIT);
  if (bounded.length > 0) {
    await markInquiriesStatement(ctx.db, bounded, status, now).run();
  }
  return undefined;
}

/**
 * Deletes inquiries for good, with their lines.
 *
 * It cannot be undone, so the action asks for a box to be ticked first, and
 * refuses without it: a request that names the action and no confirmation
 * did not come from that form.
 */
export async function deleteInquiries(
  ids: readonly string[],
  ctx: PluginContext,
  params: Readonly<Record<string, unknown>>,
): Promise<Response | undefined> {
  if (params.confirm !== true) {
    return Response.json(
      {
        error: 'Tick the box to confirm.',
        errors: { confirm: 'Tick the box to delete these inquiries for good.' },
      },
      { status: 422 },
    );
  }
  const bounded = ids.slice(0, ACTION_LIMIT);
  if (bounded.length > 0) {
    await ctx.db.batch(deleteInquiriesStatements(ctx.db, bounded));
  }
  return undefined;
}

/** The inquiries ticked, or the latest when none is, as a CSV file. */
export async function exportInquiries(
  ids: readonly string[],
  ctx: PluginContext,
  now: Date = new Date(),
): Promise<Response> {
  const inquiries = await readInquiries(ctx.db, ids, EXPORT_LIMIT);
  return new Response(inquiriesCsv(inquiries), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="inquiries-${now
        .toISOString()
        .slice(0, 10)}.csv"`,
    },
  });
}
