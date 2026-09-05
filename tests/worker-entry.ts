/**
 * 测试专用的 Worker 入口。
 *
 * vitest-pool-workers 需要一个可加载的主入口才能启动隔离运行时，而生产入口
 * `.open-next/worker.js` 是 `opennextjs-cloudflare build` 的产物，跑单元测试时
 * 并不存在。用这个空壳入口把测试与构建产物解耦：测试只用绑定（D1/KV/R2），
 * 不经由 SELF 发请求。
 */
const testWorker = {
  async fetch(): Promise<Response> {
    return new Response("nundar test worker", { status: 200 });
  },
};

export default testWorker;
