/**
 * lib/auth/permissions.ts
 *
 * R-manager-perms (2026-09-04): 실장 세부 권한 시스템.
 *
 * 사용법:
 *   import { PERMS, hasPerm, effectivePermissions } from "@/lib/auth/permissions"
 *
 *   const perms = effectivePermissions(role, membershipPermissionsJson)
 *   if (!hasPerm(perms, PERMS.STAFF_MANAGE)) return 403
 *
 * 저장:
 *   store_memberships.permissions JSONB
 *   NULL          → 기본 실장 (backward compat)
 *   { "perm.key": true, ... }
 *
 * Owner:
 *   role='owner' 이면 이 컬럼 무시 → 항상 전권.
 */

/**
 * 권한 키 (dot-namespaced).
 *   {section}.{action}
 *   view    = 조회 (탭/페이지 노출 & GET)
 *   manage  = 변경 (POST/PATCH/DELETE)
 *   send    = 전송 (채팅만)
 *   settings = 설정 변경 (매장 설정)
 */
export const PERMS = {
  // 채팅
  CHAT_VIEW: "chat.view",
  CHAT_SEND: "chat.send",
  // 조판 (매장 내 방/세션)
  ROSTER_VIEW: "roster.view",
  ROSTER_MANAGE: "roster.manage",
  // 외부조판 (건물 전체 스태프 조판)
  STAFF_VIEW: "staff.view",
  STAFF_MANAGE: "staff.manage",
  // 정산
  SETTLE_VIEW: "settle.view",
  SETTLE_MANAGE: "settle.manage",
  // 외상
  CREDITS_VIEW: "credits.view",
  CREDITS_MANAGE: "credits.manage",
  // 재고
  INVENTORY_VIEW: "inventory.view",
  INVENTORY_MANAGE: "inventory.manage",
  // 리포트
  REPORTS_VIEW: "reports.view",
  // 매장 설정 (사장급)
  STORE_SETTINGS: "store.settings",
  // 실장 관리 (사장급 — 권한 위임)
  MANAGERS_MANAGE: "managers.manage",
} as const

export type PermKey = (typeof PERMS)[keyof typeof PERMS]

/** 모든 권한 키 배열 (UI 렌더링용). */
export const ALL_PERMS: readonly PermKey[] = Object.values(PERMS)

/** 사람이 읽는 라벨 (UI 표시용) */
export const PERM_LABELS: Record<PermKey, { section: string; label: string; desc: string }> = {
  [PERMS.CHAT_VIEW]: { section: "채팅", label: "채팅 조회", desc: "채팅방 목록·메시지 읽기" },
  [PERMS.CHAT_SEND]: { section: "채팅", label: "채팅 전송", desc: "메시지 보내기 · 자동 파서" },
  [PERMS.ROSTER_VIEW]: { section: "조판", label: "조판 조회", desc: "방 상태·아가씨 조판 보기" },
  [PERMS.ROSTER_MANAGE]: { section: "조판", label: "조판 처리", desc: "체크인·체크아웃·연장·정산" },
  [PERMS.STAFF_VIEW]: { section: "외부조판", label: "외부조판 조회", desc: "타 매장 스태프 조판" },
  [PERMS.STAFF_MANAGE]: { section: "외부조판", label: "외부조판 처리", desc: "타 매장 스태프 배정" },
  [PERMS.SETTLE_VIEW]: { section: "정산", label: "정산 조회", desc: "매장 정산 요약" },
  [PERMS.SETTLE_MANAGE]: { section: "정산", label: "정산 처리", desc: "선정산·확정" },
  [PERMS.CREDITS_VIEW]: { section: "외상", label: "외상 조회", desc: "외상 내역" },
  [PERMS.CREDITS_MANAGE]: { section: "외상", label: "외상 처리", desc: "외상 등록·회수" },
  [PERMS.INVENTORY_VIEW]: { section: "재고", label: "재고 조회", desc: "품목·재고량" },
  [PERMS.INVENTORY_MANAGE]: { section: "재고", label: "재고 처리", desc: "입고·출고" },
  [PERMS.REPORTS_VIEW]: { section: "리포트", label: "리포트 조회", desc: "일일·마감 리포트" },
  [PERMS.STORE_SETTINGS]: { section: "매장", label: "매장 설정 변경", desc: "⚠ 단가·수수료 조정 (사장급)" },
  [PERMS.MANAGERS_MANAGE]: { section: "매장", label: "실장 관리", desc: "⚠ 다른 실장 퇴사·권한 설정 (사장급)" },
}

/** 기본 실장 권한 (permissions=NULL 일 때 · backward compat) */
export const DEFAULT_MANAGER_PERMS: Record<PermKey, boolean> = {
  [PERMS.CHAT_VIEW]: true,
  [PERMS.CHAT_SEND]: true,
  [PERMS.ROSTER_VIEW]: true,
  [PERMS.ROSTER_MANAGE]: true,
  [PERMS.STAFF_VIEW]: true,
  [PERMS.STAFF_MANAGE]: true,
  [PERMS.SETTLE_VIEW]: true,
  [PERMS.SETTLE_MANAGE]: true,
  [PERMS.CREDITS_VIEW]: true,
  [PERMS.CREDITS_MANAGE]: true,
  [PERMS.INVENTORY_VIEW]: true,
  [PERMS.INVENTORY_MANAGE]: true,
  [PERMS.REPORTS_VIEW]: true,
  [PERMS.STORE_SETTINGS]: false,
  [PERMS.MANAGERS_MANAGE]: false,
}

/** 사장 대행 (전권 · 위임) */
export const OWNER_DELEGATE_PERMS: Record<PermKey, boolean> = Object.fromEntries(
  ALL_PERMS.map(k => [k, true]),
) as Record<PermKey, boolean>

/** 채팅만 */
export const CHAT_ONLY_PERMS: Record<PermKey, boolean> = Object.fromEntries(
  ALL_PERMS.map(k => [k, k === PERMS.CHAT_VIEW || k === PERMS.CHAT_SEND]),
) as Record<PermKey, boolean>

/** 외부조판만 (채팅 포함) */
export const EXTERNAL_STAFF_ONLY_PERMS: Record<PermKey, boolean> = Object.fromEntries(
  ALL_PERMS.map(k => [
    k,
    k === PERMS.CHAT_VIEW || k === PERMS.CHAT_SEND
    || k === PERMS.STAFF_VIEW || k === PERMS.STAFF_MANAGE,
  ]),
) as Record<PermKey, boolean>

/** 프리셋 목록 (UI dropdown) */
export const PERMISSION_PRESETS = [
  { key: "owner_delegate", label: "🔑 사장 대행 (전권 위임)", perms: OWNER_DELEGATE_PERMS },
  { key: "default_manager", label: "👔 일반 실장 (기본 권한)", perms: DEFAULT_MANAGER_PERMS },
  { key: "chat_only", label: "💬 채팅만", perms: CHAT_ONLY_PERMS },
  { key: "external_only", label: "🏢 외부조판 전용", perms: EXTERNAL_STAFF_ONLY_PERMS },
] as const

export type PermissionMap = Partial<Record<PermKey, boolean>>

/**
 * role + DB permissions JSONB → 실효 permission map.
 *   owner  → 항상 전권
 *   manager + NULL      → default manager perms
 *   manager + {}        → 전 잠금
 *   manager + specific  → 지정된 값만 (미지정 키는 false)
 *   기타 role (hostess/waiter/staff) → 빈 map
 */
export function effectivePermissions(
  role: string,
  raw: PermissionMap | null | undefined,
): Record<PermKey, boolean> {
  if (role === "owner") return OWNER_DELEGATE_PERMS
  if (role !== "manager") {
    return Object.fromEntries(ALL_PERMS.map(k => [k, false])) as Record<PermKey, boolean>
  }
  if (raw === null || raw === undefined) return DEFAULT_MANAGER_PERMS
  const out = Object.fromEntries(ALL_PERMS.map(k => [k, false])) as Record<PermKey, boolean>
  for (const k of ALL_PERMS) {
    if (raw[k] === true) out[k] = true
  }
  return out
}

/** 단일 권한 확인 */
export function hasPerm(perms: Partial<Record<PermKey, boolean>>, key: PermKey): boolean {
  return perms[key] === true
}

/** 전권 여부 (사장 대행) */
export function isFullAccess(perms: Partial<Record<PermKey, boolean>>): boolean {
  return ALL_PERMS.every(k => perms[k] === true)
}
