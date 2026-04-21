/**
 * /monitor — 공용 진입 라우터 (서버 컴포넌트).
 *
 * 동작:
 *   1. `?force=ops` / `?force=mobile` / `?device=...` 쿼리 최우선
 *   2. `nox_device_mode` cookie
 *   3. User-Agent 기반 자동 판정
 *        - iPhone / Android.*Mobile / Mobile Safari → mobile
 *        - 그 외                                    → ops
 *
 * 항상 즉시 `redirect()` 로 종료. flash-of-wrong-tree 를 서버 측에서
 * 막는 1차 방어선. 각 트리 내부에서도 useDeviceMode 기반 2차 배너가
 * 있어 뷰포트가 UA 와 다른 경우(태블릿 가로 등) 수동 이동 가능.
 */

import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"

// App Router 서버 컴포넌트 — 정적 빌드 캐싱 회피 (UA/cookie 매 요청 평가).
export const dynamic = "force-dynamic"

type SearchParams = { force?: string; device?: string }

const MOBILE_UA_RE = /iPhone|iPod|Android.*Mobile|Mobile Safari|webOS|BlackBerry|IEMobile|Opera Mini/i

function normalizeChoice(v: string | undefined | null): "ops" | "mobile" | null {
  const s = (v ?? "").toLowerCase()
  return s === "ops" || s === "mobile" ? s : null
}

export default async function MonitorRouterPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  // 1. Query override (?force=... or ?device=...)
  const params = await searchParams
  const forced = normalizeChoice(params.force) ?? normalizeChoice(params.device)
  if (forced === "ops")    redirect("/counter/monitor")
  if (forced === "mobile") redirect("/m/monitor")

  // 2. Cookie preference (set by client when user manually switches trees).
  const c = await cookies()
  const stored = normalizeChoice(c.get("nox_device_mode")?.value)
  if (stored === "ops")    redirect("/counter/monitor")
  if (stored === "mobile") redirect("/m/monitor")

  // 3. UA fallback.
  const h = await headers()
  const ua = h.get("user-agent") ?? ""
  if (MOBILE_UA_RE.test(ua)) redirect("/m/monitor")

  redirect("/counter/monitor")
}
