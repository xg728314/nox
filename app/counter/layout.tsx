/**
 * Phase 2 — 카운터 전체 차단 (2026-06-01).
 *
 * 보안 점검 결과 (C-3): 기존 `app/counter/page.tsx` 만 redirect 였고
 * `/counter/[room_id]/*`, `/counter/monitor` 같은 깊은 링크는 그대로
 * 노출되어 우회 진입 가능했음. layout.tsx 로 모든 자식 경로 일괄 차단.
 *
 * 기존 코드 (CounterPageV2 등) 는 보존 — 다음 Phase 에 재활성화 시
 * 이 파일만 삭제하면 됨.
 */

import { redirect } from "next/navigation"

export default function CounterLayout() {
  redirect("/m/index.html")
}
