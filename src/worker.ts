// The import below is a build artefact produced by `opennextjs-cloudflare
// build`, which is why this file is excluded from tsc (see tsconfig.json). All
// logic lives in the testable src/lib; this file is wiring only.
import { default as handler } from "../.open-next/worker.js";
import { createDb } from "@/db/client";
import { runExchangeRateCron } from "@/lib/pricing/cron";

/**
 * Custom Worker entry point: reuses the fetch handler OpenNext generates and
 * adds the cron scheduled handler.
 * See https://opennext.js.org/cloudflare/howtos/custom-worker
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

// The DO Queue and DO Tag Cache classes live in the generated worker and must be
// re-exported from the custom entry point
export {
  DOQueueHandler,
  DOShardedTagCache,
  BucketCachePurge,
} from "../.open-next/worker.js";
