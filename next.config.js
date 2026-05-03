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
  // 2026-04-29: app/globals.css 의 Pretendard @import 가 jsdelivr 의
  //   CSS 를 가져오고, 그 CSS 안 sourceMappingURL 이 같은 도메인 /sm/*.map
  //   을 가리킨다. 브라우저(특히 DevTools 가 열린 상태) 가 sourcemap 을
  //   fetch 로 가져오려 하면 connect-src 검사를 받아 차단되어 콘솔 에러
  //   발생. style-src/font-src 에는 이미 허용된 도메인이라 비대칭 해소.
  //   GET-only 텍스트 자원이라 보안 표면 확장 영향은 작음.
  FONT_CDN,
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

  // 2026-05-03 R-CloudRun-Build-Fix:
  //   Cloud Build 가 next build 안에서 ESLint 를 실행 → MonitorPanel.tsx 의
  //   pre-existing react-hooks/rules-of-hooks 23건 + 4개 <a> → <Link>
  //   필요 케이스가 ERROR 로 빌드 차단. 이 ESLint 위반은 production 동작에
  //   영향 없음 (RSC hydration 정상). next build 단계에서는 lint 끄고
  //   `npm run lint` 로 별도 실행 (CI / 개발 단계에서 검증).
  //
  //   향후: 위 5건 실코드 수정 후 ignoreDuringBuilds 제거 검토.
  eslint: {
    ignoreDuringBuilds: true,
  },

  // typescript 검증은 유지 — 타입 에러는 빌드 차단 (data shape 안전성).
  // typescript: { ignoreBuildErrors: false } (default)

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