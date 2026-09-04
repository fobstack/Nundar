import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import { purgeCache } from "@opennextjs/cloudflare/overrides/cache-purge/index";
import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";
import { withRegionalCache } from "@opennextjs/cloudflare/overrides/incremental-cache/regional-cache";
import doQueue from "@opennextjs/cloudflare/overrides/queue/do-queue";
import doShardedTagCache from "@opennextjs/cloudflare/overrides/tag-cache/do-sharded-tag-cache";

export default defineCloudflareConfig({
  // 商品页与工况页为 ISR，增量缓存放 R2 并叠加区域缓存降低回源
  incrementalCache: withRegionalCache(r2IncrementalCache, {
    mode: "long-lived",
    bypassTagCacheOnCacheHit: true,
  }),
  // 去重时间型重验证，避免同一页面被并发重复再生成
  queue: doQueue,
  // 支撑后台改内容后按需 revalidate 对应商品页
  tagCache: doShardedTagCache({ baseShardSize: 12, regionalCache: true }),
  enableCacheInterception: true,
  cachePurge: purgeCache({ type: "direct" }),
});
