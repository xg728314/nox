import type { SupabaseClient } from "@supabase/supabase-js"
import type { AuthContext } from "@/lib/auth/resolveAuthContext"

/**
 * ROUND-STAFF-2: attendance / staff list 조회 가시성 모드.
 *
 *   mine_only     → 내 담당 hostess 만 (manager 기본값)
 *   store_shared  → 같은 매장 전체 (owner / super_admin 기본값, manager 선택 가능)
 *
 * SSOT: `user_preferences` 테이블, scope = "attendance_visibility",
 *       layout_config = { "mode": "mine_only" | "store_shared" }.
 *
 * 중요: 이 helper 는 조회 가시성만 결정한다. "조작 권한" 은 각 mutating
 * route 가 manager_membership_id 자기 담당 체크로 독립 시행한다.
 * 즉 manager 가 store_shared 로 설정해서 동료 담당 hostess 를 **볼 수** 있어도
 * attendance ON/OFF, work log 작성 등은 여전히 차단된다.
 */

export type AttendanceVisibilityMode = "mine_only" | "store_shared"

type PrefRow = {
  store_uuid: string | null
  layout_config: unknown
}

function coerceMode(raw: unknown): AttendanceVisibilityMode | null {
  if (!raw || typeof raw !== "object") return null
  const m = (raw as { mode?: unknown }).mode
  if (m === "mine_only" || m === "store_shared") return m
  return null
}

/**
 * owner / super_admin 은 항상 store_shared (기존 정책 유지 — 전체 열람).
 * manager 는 `user_preferences(user_id, scope='attendance_visibility')`
 *   - 매장별 override(store_uuid = auth.store_uuid) 가 있으면 우선
 *   - 없으면 global (store_uuid IS NULL)
 *   - 둘 다 없으면 기본 "mine_only"
 * 기타 role (staff/hostess 등) 은 의미 없음 → "mine_only" 반환
 *   (해당 role 은 /staff /attendance 경로 자체가 role gate 에서 이미 차단됨).
 */
export async function loadAttendanceVisibility(
  supabase: SupabaseClient,
  auth: AuthContext,
): Promise<AttendanceVisibilityMode> {
  if (auth.is_super_admin || auth.role === "owner") return "store_shared"
  if (auth.role !== "manager") return "mine_only"

  const { data, error } = await supabase
    .from("user_preferences")
    .select("store_uuid, layout_config")
    .eq("user_id", auth.user_id)
    .eq("scope", "attendance_visibility")
    .is("deleted_at", null)

  if (error || !data || data.length === 0) return "mine_only"
  const rows = data as PrefRow[]

  const perStore = rows.find((r) => r.store_uuid === auth.store_uuid)
  if (perStore) {
    const m = coerceMode(perStore.layout_config)
    if (m) return m
  }
  const global = rows.find((r) => r.store_uuid === null)
  if (global) {
    const m = coerceMode(global.layout_config)
    if (m) return m
  }
  return "mine_only"
}
