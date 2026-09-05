// 构建产物，由 opennextjs-cloudflare build 生成；因此本文件排除在 tsc 之外
// （见 tsconfig.json 的 exclude），逻辑一律放在可测的 src/lib 里，此处只做接线。
import { default as handler } from "../.open-next/worker.js";
import { createDb } from "@/db/client";
import { runExchangeRateCron } from "@/lib/pricing/cron";

/**
 * 自定义 Worker 入口：复用 OpenNext 生成的 fetch handler，另加 Cron 的 scheduled handler。
 * 见 https://opennext.js.org/cloudflare/howtos/custom-worker
 */
const worker = {
  fetch: handler.fetch,

  async scheduled(
    _event: ScheduledController,
    env: CloudflareEnv,
    ctx: ExecutionContext,
  ) {
    ctx.waitUntil(
      runExchangeRateCron(createDb(env.DB)).then((outcome) => {
        if (outcome.ok) {
          console.log(
            `[cron] ECB ${outcome.date}: repriced ${outcome.result.updated}, held ${outcome.result.skipped}, manual ${outcome.result.manual}`,
          );
        } else {
          console.error(
            `[cron] exchange rate refresh failed, keeping previous snapshot: ${outcome.reason}`,
          );
        }
      }),
    );
  },
};

export default worker;

// DO Queue 与 DO Tag Cache 的类在生成的 worker 里，必须从自定义入口再导出一次
export {
  DOQueueHandler,
  DOShardedTagCache,
  BucketCachePurge,
} from "../.open-next/worker.js";
