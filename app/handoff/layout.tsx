/**
 * Hand-off — 외부 개발자용 페이지별 spec + 스크린샷 + API + DB.
 *
 * 권한: super_admin 만 접근 (auth 가드는 page 에서 처리).
 *
 * 데이터 출처:
 *   - handoff/data/pages.json (자동 생성 — scripts/generate-handoff-data.mjs)
 *   - handoff/data/pages-meta.json (수동 보강)
 *   - public/handoff/screens/*.png (Playwright — TODO)
 */
import type { ReactNode } from "react"

export const metadata = { title: "Hand-off — NOX" }

export default function HandoffLayout({ children }: { children: ReactNode }) {
  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(180deg, #F5EFE3 0%, #EDE5D2 100%)",
      color: "#2D2B26",
      fontFamily: "system-ui, -apple-system, sans-serif",
    }}>
      {children}
    </div>
  )
}
