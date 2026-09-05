import type { NextConfig } from "next";

/**
 * 安全响应头。
 *
 * Next.js 默认不加这些头，但商城站每一条都对应一个真实攻击面：
 * 被 iframe 嵌套可做点击劫持（诱导点到真实的加购/结账按钮），
 * MIME 嗅探可把上传的文件当脚本执行，Referrer 外泄会把订单号带给第三方。
 */
const SECURITY_HEADERS = [
  // 禁止被任何站点嵌套。商城没有任何需要被 iframe 引用的场景，
  // 而"看起来像自己站点"的覆盖层正是点击劫持的做法。
  { key: "X-Frame-Options", value: "DENY" },

  // 关闭 MIME 嗅探：浏览器一律按声明的 Content-Type 处理
  { key: "X-Content-Type-Options", value: "nosniff" },

  // 跨源只发送来源，不带路径——订单号在 URL 里，不该泄漏给第三方
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },

  // 本站不需要这些能力，显式关掉可减少被注入脚本利用的空间
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },

  // 一年 HSTS 并包含子域。上线前确认所有子域都能走 HTTPS 再启用 preload。
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
];

/**
 * CSP。
 *
 * 'unsafe-inline' 出现在 style-src 是因为主题大量使用内联 style——那是刻意的
 * 设计（属性面板可编辑、换主题只改 token）。script-src 不给 'unsafe-inline'，
 * 脚本注入这条主要路径仍然被堵死。
 *
 * connect-src 放行 Stripe 与 ECB：前者是结账跳转前的校验请求，后者是汇率源。
 * frame-src 放行 Stripe：托管结账页可能以 3DS 弹窗形式出现。
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://api.stripe.com https://www.ecb.europa.eu",
  "frame-src https://js.stripe.com https://hooks.stripe.com",
  "form-action 'self' https://checkout.stripe.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");

/**
 * 改这个文件时注意：`experimental` 与 `headers()` 都是必需的，不要因为只关心
 * 其中一半就整体重写——曾经加安全响应头时覆盖掉 experimental，导致构建期
 * D1 并发崩溃回归。
 */
const nextConfig: NextConfig = {
  experimental: {
    // 构建期 generateStaticParams 要读本地 D1；多个构建 worker 并发连同一个
    // miniflare SQLite 会触发 D1 internal error，故限制为单 worker 串行构建
    cpus: 1,
    workerThreads: false,
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          ...SECURITY_HEADERS,
          { key: "Content-Security-Policy", value: CSP },
        ],
      },
    ];
  },
};

export default nextConfig;

// 让 next dev 也能拿到 D1 / R2 / KV 绑定，否则本地开发取不到 Cloudflare 上下文
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
