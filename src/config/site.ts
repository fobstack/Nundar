/**
 * 站点级配置。
 *
 * SITE.url 必须是不带尾斜杠的绝对源，canonical 与 hreflang 都基于它构造——
 * 部署到正式域名前务必设置 NEXT_PUBLIC_SITE_URL，否则线上页面会输出 localhost
 * 的 canonical，导致整站无法被正确收录。
 */
const rawUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const SITE = {
  url: rawUrl.replace(/\/+$/, ""),
  name: "Nundar",
} as const;
