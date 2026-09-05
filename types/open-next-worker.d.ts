/**
 * `.open-next/worker.js` 是 `opennextjs-cloudflare build` 的产物，干净克隆后
 * 首次构建前并不存在，而 src/worker.ts 必须导入它。
 *
 * 通配符模块声明只在 TypeScript 无法解析到真实文件时生效——构建产物存在时，
 * 用的仍是产物自带的真实类型。有了它，clone 后不构建也能 `pnpm typecheck`。
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
