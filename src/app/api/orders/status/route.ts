import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import * as schema from "@/db/schema";

/**
 * 查订单状态，供支付成功页轮询。
 *
 * 订单状态以 webhook 为准，而 webhook 与用户跳回成功页是并发的——
 * 用户很可能先到页面、webhook 后到，所以成功页要显示"处理中"并轮询。
 *
 * 只返回单号与状态，不返回金额、地址等信息：单号可能被猜到或分享。
 */
export async function GET(request: Request) {
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
