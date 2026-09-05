/**
 * A Worker entry point used only by the tests.
 *
 * vitest-pool-workers needs a loadable main entry to start its isolated
 * runtime, and the production entry `.open-next/worker.js` is a build artefact
 * that does not exist while unit tests run. This stub decouples the tests from
 * the build: they use the bindings (D1, KV, R2) directly and never send a
 * request through SELF.
 */
const testWorker = {
  async fetch(): Promise<Response> {
    return new Response("nundar test worker", { status: 200 });
  },
};

export default testWorker;
