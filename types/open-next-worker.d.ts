/**
 * `.open-next/worker.js` is produced by `opennextjs-cloudflare build`. In a
 * clean clone it does not exist until the first build, yet src/worker.ts has to
 * import it.
 *
 * A wildcard module declaration only applies when TypeScript cannot resolve the
 * real file, so once the artefact exists its own types win. With this in place,
 * `pnpm typecheck` works on a fresh clone without building first.
 */
declare module "*/.open-next/worker.js" {
  const handler: {
    fetch: ExportedHandlerFetchHandler<CloudflareEnv>;
  };
  export default handler;

  export const DOQueueHandler: typeof import("cloudflare:workers").DurableObject;
  export const DOShardedTagCache: typeof import("cloudflare:workers").DurableObject;
  export const BucketCachePurge: typeof import("cloudflare:workers").DurableObject;
}
