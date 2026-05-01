/**
 * R-Manager-Permissions (2026-05-01): 실장별 메뉴 권한 helper.
 *
 * 정책 (사용자 결정):
 *   - default ON: row 없거나 permissions={} → 모든 메뉴 ON.
 *   - 사장이 명시적으로 false 박은 메뉴만 OFF.
 *
 * 메뉴 key 표준 (ManagerBottomNav 9 탭과 동일):
 *   counter / attendance / my_settlement / my_ledger / payouts /
 *   customers / staff_ledger / chat / my_info
 *
 * 클라이언트 / 서버 모두 사용 가능 (DB 의존 없는 순수 helper + DB 의존 함수 분리).
 */

import type { SupabaseClient } from "@supabase/supabase-js"

/** 메뉴 key — ManagerBottomNav 의 9 탭에 대응. */
export const MANAGER_MENU_KEYS = [
  "counter",
  "attendance",
  "my_settlement",
  "my_ledger",
  "payouts",
  "customers",
  "staff_ledger",
  "chat",
  "my_info",
] as const

export type ManagerMenuKey = (typeof MANAGER_MENU_KEYS)[number]

export const MANAGER_MENU_LABELS: Record<ManagerMenuKey, string> = {
  counter: "카운터",
  attendance: "배정",
  my_settlement: "내 정산",
  my_ledger: "내 수익",
  payouts: "지급",
  customers: "고객·외상",
  staff_ledger: "스태프장부",
  chat: "채팅",
  my_info: "내 정보",
}

/** 메뉴 path 매핑 (UI redirect / nav 진입점). */
export const MANAGER_MENU_PATHS: Record<ManagerMenuKey, string> = {
  counter: "/counter",
  attendance: "/attendance",
  my_settlement: "/manager/settlement",
  my_ledger: "/manager/ledger",
  payouts: "/payouts",
  customers: "/customers",
  staff_ledger: "/reconcile/staff",
  chat: "/chat",
  my_info: "/me",
}

/** permissions jsonb → 단일 menu key 의 ON/OFF 판정. default ON. */
export function isMenuEnabled(
  permissions: Record<string, unknown> | null | undefined,
  key: ManagerMenuKey,
): boolean {
  if (!permissions) return true // row 없음 → ON
  const v = permissions[key]
  if (v === false) return false // 명시적 OFF 만 차단
  return true // undefined / true / 그 외 → ON
}

/** 모든 메뉴의 ON/OFF map. UI 토글에 그대로 사용. */
export function buildMenuMap(
  permissions: Record<string, unknown> | null | undefined,
): Record<ManagerMenuKey, boolean> {
  const out = {} as Record<ManagerMenuKey, boolean>
  for (const k of MANAGER_MENU_KEYS) {
    out[k] = isMenuEnabled(permissions, k)
  }
  return out
}

/** DB 조회 — 본인 또는 특정 실장의 권한 row. */
export async function fetchManagerMenuPermissions(
  supabase: SupabaseClient,
  store_uuid: string,
  membership_id: string,
): Promise<Record<string, unknown>> {
  const { data, error } = await supabase
    .from("manager_menu_permissions")
    .select("permissions")
    .eq("store_uuid", store_uuid)
    .eq("membership_id", membership_id)
    .maybeSingle()
  if (error) {
    // eslint-disable-next-line no-console
    console.warn("[managerMenuPermissions] fetch failed:", error.message)
    return {}
  }
  const row = data as { permissions?: Record<string, unknown> } | null
  return row?.permissions ?? {}
}

/** DB 저장 — 사장이 토글 변경 시 upsert. */
export async function saveManagerMenuPermissions(
  supabase: SupabaseClient,
  args: {
    store_uuid: string
    membership_id: string
    permissions: Record<string, boolean>
    updated_by_user_id: string
    updated_by_membership_id: string
  },
): Promise<{ ok: boolean; error?: string }> {
  // 알려진 key 만 필터 (oversharing / 잘못된 key 차단)
  const filtered: Record<string, boolean> = {}
  for (const k of MANAGER_MENU_KEYS) {
    const v = args.permissions[k]
    if (typeof v === "boolean") filtered[k] = v
  }

  const { error } = await supabase
    .from("manager_menu_permissions")
    .upsert(
      {
        store_uuid: args.store_uuid,
        membership_id: args.membership_id,
        permissions: filtered,
        updated_by_user_id: args.updated_by_user_id,
        updated_by_membership_id: args.updated_by_membership_id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "store_uuid,membership_id" },
    )
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
