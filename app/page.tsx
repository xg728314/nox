import { redirect } from "next/navigation"

/**
 * Phase 2 — 실장 어플 전환 (2026-06-01).
 * Phase 3 (2026-06-03) — 정적 HTML mock 을 Next.js Route 로 전환.
 *
 * nox.ai.kr 진입 = 스태프동기화 모바일 앱 (/m).
 */
export default function HomePage() {
  redirect("/m")
}
