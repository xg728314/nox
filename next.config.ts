import type { NextConfig } from "next"

/**
 * Permanent (308) redirect for the deprecated `/approvals` path.
 *
 * In the members-UI-restructure round the canonical approvals route
 * became `/admin/approvals` (under the 회원 관리 section). Legacy
 * bookmarks and any stale JS that still navigates to `/approvals`
 * are transparently redirected. Sub-path form covers any future
 * additions.
 *
 * Next.js applies these redirects BEFORE middleware, so the
 * `/approvals/:path*` matcher entry in `middleware.ts` becomes dead
 * weight — intentionally left in place as belt-and-suspenders until
 * production traffic confirms the redirect.
 */
/**
 * 2026-04-25: 프로덕션 보안 헤더 일괄 적용.
 *
 *   X-Frame-Options: DENY
 *     클릭재킹 방어 — 이 앱은 iframe 안에서 동작할 이유가 없음.
 *   X-Content-Type-Options: nosniff
 *     MIME sniffing 방지.
 *   Referrer-Policy: strict-origin-when-cross-origin
 *     외부 링크 이동 시 경로/쿼리 노출 안 함.
 *   Permissions-Policy
 *     불필요한 권한 (camera/mic/geo 등) 원천 차단.
 *   Strict-Transport-Security
 *     프로덕션 HTTPS 강제 (Vercel 자동 HTTPS 전제).
 *   X-DNS-Prefetch-Control: on
 *     외부 도메인(Supabase) DNS prefetch 로 속도 개선.
 *
 * R28-fix (2026-04-26): CSP 추가.
 *   - 'self' 만 기본 허용. inline script 는 'unsafe-inline' 일단 허용 (Next.js 의
 *     hydration script 가 inline 이라 dev 에서 false positive 다수). nonce 기반
 *     CSP 는 후속 라운드.
 *   - connect-src 에 supabase + sentry + anthropic 명시.
 *   - frame-ancestors 'none' 으로 X-Frame-Options 보강.
 */
const SUPABASE_URL_HOST = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")
  .replace(/^https?:\/\//, "")
  .replace(/\/$/, "")

// R29-fix (2026-04-26): Pretendard 폰트가 jsdelivr CDN 에서 로드됨 (globals.css line 7).
//   기존 CSP 가 jsdelivr 미허용 → CSS + woff2 모두 차단.
//   style-src + font-src 에 cdn.jsdelivr.net 추가.
const FONT_CDN = "https://cdn.jsdelivr.net"

const CSP_DIRECTIVES = [
  "default-src 'self'",
  // inline script: Next.js hydration 이 inline 사용. nonce 도입은 후속 라운드.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  `style-src 'self' 'unsafe-inline' ${FONT_CDN}`,
  "img-src 'self' data: blob: https:",
  `font-src 'self' data: ${FONT_CDN}`,
  // connect-src: 외부로 통신 허용된 origin 명시 (Supabase / Sentry / Anthropic).
  `connect-src 'self' https://${SUPABASE_URL_HOST} wss://${SUPABASE_URL_HOST} https://*.sentry.io https://api.anthropic.com`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].filter(d => !d.includes("https:// ")).join("; ")

const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "Content-Security-Policy", value: CSP_DIRECTIVES },
]

const nextConfig: NextConfig = {
  // 2026-04-26: dev 모드의 Next.js 표시기 (좌하단 N 버튼) 비활성.
  //   사용자 피드백: 채팅 입력창과 위치가 겹쳐서 거슬림.
  //   production 빌드는 어차피 자동 비활성이라 영향 없음.
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

export default nextConfig
