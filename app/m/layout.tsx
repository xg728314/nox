/**
 * 모바일 트리 루트 — /m/*.
 *
 * 2026-06-03 R-스태프동기화-Next: 정적 HTML mock (public/m/*.html, 18장) 을
 *   _arch/legacy-mock/ 으로 백업하고 Next.js App Router 로 새로 구축.
 *
 *   - /m            → 홈 (대시보드)
 *   - /m/staff/*    → 스태프 관리
 *   - /m/chat/*     → 채팅
 *   - /m/settle/*   → 정산
 *   - /m/me/*       → 내정보
 *   - /m/store/*    → 매장 설정
 *   - /m/assign/*   → 세션 등록
 *   - /m/monitor/*  → 기존 모니터 (별도 dark sublayout 사용)
 *
 *   루트 레이아웃은 안전영역(safe-area) padding 만 적용하고, 실제 폰
 *   프레임/탭바/토스트 등은 (app) route group 의 sublayout 에서 처리.
 *   monitor 도 동일하게 자체 sublayout 으로 격리.
 */
import type { Metadata, Viewport } from "next"
import type { ReactNode } from "react"

export const metadata: Metadata = {
  title: "스태프동기화",
  description: "14매장 실장 공동 사용 — 5~8F 스태프 동기화",
  applicationName: "스태프동기화",
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#F8F4ED",
}

export default function MobileRootLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}
