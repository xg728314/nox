"use client"
import { useApi } from "./useApi"

/** 본인 정보 + 매장 + 라벨 */
export type MeResponse = {
  user_id: string
  membership_id: string
  store_uuid: string
  store_name: string | null
  store_floor: number | null
  role: "owner" | "manager" | "waiter" | "staff" | "hostess"
  membership_status: string
  is_super_admin: boolean
  mfa_enabled: boolean
  backup_codes_remaining: number
  display_labels: Record<string, string>
  full_name: string | null
}

export function useMe() {
  return useApi<MeResponse>("/api/auth/me", { ttl: 30_000 })
}

/** 본 매장 hostess 목록 (담당 식구) */
export type HostessPreview = {
  hostess_id: string
  hostess_name: string
  membership_id: string
  profile_id: string | null
  role: string
  status: string
  manager_membership_id: string | null
  origin_store_uuid: string | null
  /** R-cross-store-working (2026-06-24): 어디서든 active session 참여 중. */
  is_working?: boolean
  working_store_uuid?: string | null
  /** R-working-detail (2026-06-25): UI 상세 표시용 */
  working_store_name?: string | null
  working_category?: string | null
  working_time_minutes?: number | null
  working_entered_at?: string | null
}
/** 사전등록 row (가입 대기) */
export type PreRegistrationPreview = {
  pre_registration_id: string
  hostess_name: string
  phone: string
  stage_name: string | null
  note: string | null
  created_at: string
  manager_membership_id: string
  is_pending: true
}
export type HostessesResponse = {
  store_uuid: string
  role: string
  hostesses: HostessPreview[]
  pre_registrations?: PreRegistrationPreview[]
}
export function useHostesses() {
  return useApi<HostessesResponse>("/api/manager/hostesses", { ttl: 5000 })
}

/** 5–8F 전체 hostess 목록 (메이드 등록 시트 picker) */
export type BuildingHostess = {
  hostess_id: string
  membership_id: string
  profile_id: string
  hostess_name: string
  store_uuid: string
  store_name: string
  floor: number | null
  manager_membership_id: string | null
  manager_name: string
  origin_store_uuid: string | null
  origin_store_name: string
}
export function useBuildingHostesses() {
  return useApi<{ hostesses: BuildingHostess[] }>("/api/building/hostesses", { ttl: 30_000 })
}

/** 5–8F 매장 목록 */
export type BuildingStore = { store_uuid: string; store_name: string; floor: number | null }
export function useBuildingStores() {
  return useApi<{ stores: BuildingStore[] }>("/api/building/stores", { ttl: 300_000 })
}

/** 본 매장 룸 + 활성 세션 */
export type SessionInfo = {
  id: string
  status: string
  started_at: string
  participant_count: number
  gross_total: number
  manager_name: string | null
}
export type RoomWithSession = {
  id: string
  room_no: string
  room_name: string
  is_active: boolean
  session: SessionInfo | null
  floor_no?: number
}
export function useRooms() {
  return useApi<{ store_uuid: string; rooms: RoomWithSession[] }>("/api/rooms", { ttl: 10_000 })
}

/** 종목 단가 */
export type ServiceType = {
  service_type: string
  time_type: string
  time_minutes: number
  price: number
  manager_deduction: number
  has_greeting_check: boolean
}
export function useServiceTypes() {
  return useApi<{ service_types: ServiceType[] }>("/api/store/service-types", { ttl: 60_000 })
}

/** 채팅방 목록 */
export type ChatRoom = {
  id: string
  type: "global" | "room_session" | "group" | "direct"
  /** 백엔드 우선 표시 이름 (수동 설정 > 참여자 자동 > 기본) */
  title: string
  /** 백엔드 alias (이전 호환) */
  display_name?: string
  /** 사용자가 설정한 원본 이름 (없으면 null) */
  name?: string | null
  last_message: string | null
  last_message_text?: string | null
  last_message_at: string | null
  unread_count: number
  /** 그룹 채팅 참여자 이름 상위 5명 (본인 제외) */
  participant_names?: string[]
  participant_count?: number
  pinned_at?: string | null
  is_creator?: boolean
}
export function useChatRooms() {
  return useApi<{ rooms: ChatRoom[] }>("/api/chat/rooms", { ttl: 5000 })
}

/** 정산 요약 — 서버 응답 형태에 맞춤 (lib/server/queries/manager/settlementSummary.ts) */
export type SettlementSummaryRow = {
  hostess_id: string
  hostess_name: string
  has_settlement: boolean
  status: string | null
  gross_total: number | null
  tc_amount: number | null
  manager_amount: number | null
  hostess_amount: number | null
  /** R-settle-display (2026-06-24): 세션 카운트 — 백엔드 추가 후 채워짐. */
  tc_count?: number
}
export type SettlementSummary = {
  store_uuid: string
  role: string
  business_day_id: string | null
  summary: SettlementSummaryRow[]
}
export function useSettlement() {
  return useApi<SettlementSummary>("/api/manager/settlement/summary", { ttl: 10_000 })
}

/** 출근 상태 */
export type AttendanceRow = {
  membership_id: string
  hostess_name: string
  status: "present" | "absent" | "on_break"
  checked_in_at: string | null
  room_uuid: string | null
}
export function useAttendance() {
  return useApi<{ attendance: AttendanceRow[] }>("/api/attendance", { ttl: 5000 })
}
