 /** @type {import('next').NextConfig} */

const SUPABASE_URL_HOST = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")
  .replace(/^https?:\/\//, "")
  .replace(/\/$/, "")

const FONT_CDN = "https://cdn.jsdelivr.net"

const connectSrc = [
  "'self'",
  SUPABASE_URL_HOST ? `https://${SUPABASE_URL_HOST}` : null,
  SUPABASE_URL_HOST ? `wss://${SUPABASE_URL_HOST}` : null,
  "https://*.sentry.io",
  "https://api.anthropic.com",
]
  .filter(Boolean)
  .join(" ")

const CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  `style-src 'self' 'unsafe-inline' ${FONT_CDN}`,
  "img-src 'self' data: blob: https:",
  `font-src 'self' data: ${FONT_CDN}`,
  `connect-src ${connectSrc}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ")

const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  {
    key: "Permissions-Policy",
    // camera=(self): 자기 origin 만 카메라 허용 (다른 origin 의 iframe embed 는 차단).
    //   /reconcile 의 getUserMedia 가 동작하려면 self 허용 필수. 빈 allowlist `()` 는
    //   자기 origin 까지 차단해서 NotAllowedError 즉시 throw 됨.
    // microphone / geolocation / 기타: NOX 가 쓰지 않으므로 차단 유지.
    value:
      "camera=(self), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "Content-Security-Policy", value: CSP_DIRECTIVES },
]

const nextConfig = {
  output: "standalone",
  devIndicators: false,

  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ]
  },

  async redirects() {
    return [
      {
        source: "/approvals",
        destination: "/admin/approvals",
        permanent: true,
      },
      {
        source: "/approvals/:path*",
        destination: "/admin/approvals/:path*",
        permanent: true,
      },
    ]
  },
}

module.exports = nextConfig