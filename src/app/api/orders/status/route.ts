import { eq } from "drizzle-orm";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/db/client";
import * as schema from "@/db/schema";
import {
  checkRateLimit,
  clientIdentifier,
  RATE_LIMITS,
  rateLimitedResponse,
} from "@/lib/security/rate-limit";

/**
 * Order status, polled by the payment success page.
 *
 * The webhook is what decides an order's status, and it races the buyer's
 * return to the success page. The buyer usually arrives first, which is why the
 * page shows "processing" and polls.
 *
 * Returns the order number and status only — never amounts or addresses, since
 * an order number can be guessed or shared.
 */
export async function GET(request: Request) {
  // Order numbers are enumerable (a date plus six hex digits), and the rate limit
  // is what makes probing them expensive
  const { env } = getCloudflareContext();
  const limit = await checkRateLimit(
    env.SESSIONS,
    `order-status:${clientIdentifier(request)}`,
    RATE_LIMITS.orderStatus,
  );
  if (!limit.allowed) {
    return rateLimitedResponse(limit);
  }

  const orderNo = new URL(request.url).searchParams.get("orderNo") ?? "";

  if (!orderNo) {
    return Response.json({ error: "orderNo is required" }, { status: 400 });
  }

  const [order] = await getDb()
    .select({
      orderNo: schema.orders.orderNo,
      status: schema.orders.status,
    })
    .from(schema.orders)
    .where(eq(schema.orders.orderNo, orderNo))
    .limit(1);

  if (!order) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  return Response.json(order, {
    headers: { "Cache-Control": "no-store" },
  });
}
