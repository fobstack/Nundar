import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import { purgeCache } from "@opennextjs/cloudflare/overrides/cache-purge/index";
import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";
import { withRegionalCache } from "@opennextjs/cloudflare/overrides/incremental-cache/regional-cache";
import doQueue from "@opennextjs/cloudflare/overrides/queue/do-queue";
import doShardedTagCache from "@opennextjs/cloudflare/overrides/tag-cache/do-sharded-tag-cache";

export default defineCloudflareConfig({
  // Product and use-case pages are ISR; the incremental cache lives in R2 with a
  // regional cache in front to cut origin traffic
  incrementalCache: withRegionalCache(r2IncrementalCache, {
    mode: "long-lived",
    bypassTagCacheOnCacheHit: true,
  }),
  // Deduplicates time-based revalidation so one page is not regenerated twice at once
  queue: doQueue,
  // Lets an admin edit revalidate exactly the product pages it touched
  tagCache: doShardedTagCache({ baseShardSize: 12, regionalCache: true }),
  enableCacheInterception: true,
  cachePurge: purgeCache({ type: "direct" }),
});
