/**
 * 서버 사이드 빌드 모드 감지.
 *
 * 우선순위:
 *   1. NEXT_PUBLIC_BUILD_MODE 환경 변수 (빌드 시점 결정)
 *   2. User-Agent 의 "NOX-App" suffix (Capacitor 앱)
 *   3. 미지정 → "web" (default)
 *
 * 사용:
 *   - API route 에서 라벨 default 결정 시.
 *   - SSR 페이지에서 초기 라벨 결정 시.
 */

export function detectModeFromUserAgent(userAgent: string | null | undefined): "app" | "web" {
  if (!userAgent) return "web"
  if (userAgent.includes("NOX-App")) return "app"
  return "web"
}

export function detectModeFromRequest(request: Request): "app" | "web" {
  // 우선순위 1: 빌드 시 결정
  if (process.env.NEXT_PUBLIC_BUILD_MODE === "app") return "app"
  // 우선순위 2: User-Agent
  const ua = request.headers.get("user-agent")
  return detectModeFromUserAgent(ua)
}
