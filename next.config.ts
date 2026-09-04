import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // 构建期 generateStaticParams 要读本地 D1；多个构建 worker 并发连同一个
    // miniflare SQLite 会触发 D1 internal error，故限制为单 worker 串行构建
    cpus: 1,
    workerThreads: false,
  },
};

export default nextConfig;

// 让 next dev 也能拿到 D1 / R2 / KV 绑定，否则本地开发取不到 Cloudflare 上下文
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
