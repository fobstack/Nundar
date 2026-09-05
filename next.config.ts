import type { NextConfig } from "next";

/**
 * Security response headers.
 *
 * Next.js sets none of these by default, and on a storefront each one closes a
 * real attack surface: being framed enables clickjacking (an overlay that
 * tricks a visitor into hitting the genuine add-to-cart or checkout button),
 * MIME sniffing can get an uploaded file executed as a script, and a leaked
 * referrer hands order numbers to third parties.
 */
const SECURITY_HEADERS = [
  // Refuse framing by anyone. A storefront has no legitimate reason to be
  // embedded, and an overlay that "looks like the real site" is precisely how
  // clickjacking works.
  { key: "X-Frame-Options", value: "DENY" },

  // No MIME sniffing: the browser must honour the declared Content-Type
  { key: "X-Content-Type-Options", value: "nosniff" },

  // Cross-origin, send the origin only and never the path — order numbers live
  // in URLs and must not reach third parties
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },

  // The site needs none of these capabilities; denying them explicitly narrows
  // what an injected script could reach for
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },

  // One year of HSTS, subdomains included. Confirm every subdomain serves
  // HTTPS before adding preload.
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
];

/**
 * Content Security Policy.
 *
 * 'unsafe-inline' appears in style-src because themes lean on inline styles,
 * which is a deliberate design choice: a theme is swapped by redefining tokens
 * rather than by shipping a stylesheet pipeline. script-src grants no
 * 'unsafe-inline', so the main script-injection path stays closed.
 *
 * connect-src allows Stripe and the ECB: the first for the validation call made
 * before redirecting to checkout, the second as the exchange-rate source.
 * frame-src allows Stripe because hosted checkout may raise a 3DS dialog.
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
 * When editing this file: `experimental` and `headers()` are both required.
 * Do not rewrite the file wholesale because you only care about one of them —
 * adding the security headers once overwrote `experimental` and brought back a
 * D1 concurrency crash at build time.
 */
const nextConfig: NextConfig = {
  experimental: {
    // generateStaticParams reads the local D1 during the build. Several build
    // workers hitting the same miniflare SQLite file concurrently trigger a D1
    // internal error, so the build is pinned to a single serial worker.
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

// Give `next dev` the D1 / R2 / KV bindings too; without this the local server
// has no Cloudflare context at all
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
