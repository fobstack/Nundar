import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

export default nextConfig;

// 让 next dev 也能拿到 D1 / R2 / KV 绑定，否则本地开发取不到 Cloudflare 上下文
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
