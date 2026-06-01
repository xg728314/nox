import { redirect } from "next/navigation"

/**
 * Phase 2 — 실장 어플 전환 (2026-06-01).
 *
 * nox.ai.kr 진입 = 실장 어플 mock 화면 (public/m/index.html).
 * 카운터 / 로그인 등 기존 라우트는 그대로 두되, 메인 노출에서 제외.
 *
 * 이유:
 *   - 실 사용자 = 실장. 카운터는 아직 사용 단계 아님.
 *   - mock 디자인 확정. 데이터 연결은 점진적 (Phase 3).
 *
 * 정적 HTML 서빙: Next.js public/* → /m/index.html
 */
export default function HomePage() {
  redirect("/m/index.html")
}
