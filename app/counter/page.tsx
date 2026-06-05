/**
 * Phase 2 — 카운터 진입 차단 (2026-06-01).
 *
 * 실장 어플 전환 단계 동안 카운터는 사용 단계 아님.
 * 진입 시 메인(실장 어플) 으로 자동 리다이렉트.
 *
 * 기존 CounterPageV2 코드는 보존 (다음 Phase 에 사용).
 * 다시 노출하려면 이 파일을 `export { default } from "./CounterPageV2"` 로 되돌리면 됨.
 */

import { redirect } from "next/navigation"

export default function CounterEntryRedirect() {
  redirect("/m")
}
