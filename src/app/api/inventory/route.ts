import { z } from "zod";
import { CURRENCIES, BASE_CURRENCY } from "@/config/currency";
import { getDb } from "@/db/client";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getLiveInventory } from "@/lib/queries/inventory";
import {
  checkRateLimit,
  clientIdentifier,
  RATE_LIMITS,
  rateLimitedResponse,
} from "@/lib/security/rate-limit";

/** At most 50 SKUs per call: a page carries far fewer, so a larger request can
 * only be abuse. */
const MAX_VARIANTS = 50;

const querySchema = z.object({
  variants: z
    .string()
    .min(1)
    .transform((value) =>
      value
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean),
    )
    .refine((ids) => ids.length > 0 && ids.length <= MAX_VARIANTS, {
      message: `variants must contain between 1 and ${MAX_VARIANTS} ids`,
    }),
  currency: z.enum(CURRENCIES).default(BASE_CURRENCY),
});

export async function GET(request: Request) {
  const { env } = getCloudflareContext();
  const limit = await checkRateLimit(
    env.SESSIONS,
    `inventory:${clientIdentifier(request)}`,
    RATE_LIMITS.inventory,
  );
  if (!limit.allowed) {
    return rateLimitedResponse(limit);
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    variants: url.searchParams.get("variants") ?? "",
    currency: url.searchParams.get("currency") ?? undefined,
  });

  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "invalid query" },
      { status: 400 },
    );
  }

  const items = await getLiveInventory(
    getDb(),
    parsed.data.variants,
    parsed.data.currency,
  );

  return Response.json(
    { items },
    {
      // Stock has to be live; caching would defeat the point of this endpoint
      headers: { "Cache-Control": "no-store" },
    },
  );
}
