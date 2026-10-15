import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

/**
 * The Content-Security-Policy is part of the privacy promise, not decoration:
 * `connect-src` limits where the page may send data. Only the optional
 * DuckDB-WASM bundle (jsDelivr) and the opt-in AI layer (Anthropic API) are
 * reachable; everything else stays in the browser.
 */
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' data: blob: https://cdn.jsdelivr.net https://api.anthropic.com",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  async headers() {
    const security = [
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ];
    if (isProd) security.push({ key: "Content-Security-Policy", value: csp });
    return [{ source: "/:path*", headers: security }];
  },
};

export default nextConfig;
