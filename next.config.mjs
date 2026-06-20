/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === "production";

// Build a strict-but-pragmatic CSP. Drive embeds and OAuth need exceptions.
const csp = [
  "default-src 'self'",
  // 'unsafe-inline' for script is required for Next inline runtime; 'unsafe-eval' only in dev.
  `script-src 'self' 'unsafe-inline' ${isProd ? "" : "'unsafe-eval'"} https://accounts.google.com`.trim(),
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://accounts.google.com",
  "frame-src 'self' https://drive.google.com https://accounts.google.com",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://accounts.google.com",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  { key: "X-DNS-Prefetch-Control", value: "on" },
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
    optimizePackageImports: ["lucide-react"],
    // Client-side Router Cache lifetimes. Next 15 defaults `dynamic` to 0, which
    // makes every back/sidebar navigation to a dynamic page (e.g. the
    // analytics-heavy /admin home) refetch and re-run its loading skeleton. With
    // a non-zero window, an already-visited or prefetched page is reused from
    // the client cache — instant return, no skeleton flash — while still being
    // revalidated in the background. Mutations that call revalidatePath/Tag
    // still bust the cache, so this never serves data stale past a write.
    staleTimes: {
      dynamic: 180,
      static: 300,
    },
  },
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      { protocol: "https", hostname: "**" },
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        source: "/api/:path*",
        headers: [
          ...securityHeaders,
          { key: "Cache-Control", value: "no-store" },
        ],
      },
    ];
  },
};

export default nextConfig;
