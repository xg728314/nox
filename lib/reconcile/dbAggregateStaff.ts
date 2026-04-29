/**
 * R-Staff (2026-04-30): 스태프 종이장부 비교용 DB 집계.
 *
 * 출력:
 *   업무일 1일치 매장 내 hostess 별 합계.
 *   { membership_id, name, origin_store, tc_count, total_payout_won,
 *     by_category: { 퍼블릭, 셔츠, 하퍼 }, time_minutes_total }
 *
 * 데이터 소스: session_participants (role='hostess') × hostesses (name 매핑)
 *   business_day_id 또는 business_date fallback.
 *
 * 매장 스코프:
 *   - 호출자가 store_uuid 검증 후 호출.
 *   - 이 함수는 store_uuid + business_date 만으로 조회.
 *
 * 정책:
 *   - cross-store: participant.store_uuid = "일한 매장" (workplace).
 *     본 집계는 "이 매장에서 일한 모든 hostess (자체 + 외부)" 를 반환.
 *     paper 장부는 보통 본인 매장 staff 만 적혀 있을 것.
 *   - origin_store 는 hostesses.origin_store_uuid → stores.store_name 매핑.
 *     그래야 paper "이름·매장" (예: "한별·발리") 의 origin 부분과 매칭 가능.
 *   - hostess_payout_amount 는 사장 응답에서 마스킹되지만 종이장부 비교는
 *     운영 검수 도구라 owner/manager 본인 (이 매장 범위) 가 이미 권한
 *     보유 — RECONCILE_ROLE_DEFAULTS 가 access 게이트.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import type { ServiceType } from "./types"

export type StaffDailyRow = {
  membership_id: string | null     // null = external_name 만 있는 게스트
  name: string                     // hostess 표시명
  origin_store: string | null      // 본 매장 본인이면 null, 외부면 매장명
  tc_count: number                 // 해당일 참여 TC 건수 (= participant 행 수)
  total_payout_won: number         // hostess_payout_amount 합 (그날 받을 돈)
  by_category: Record<ServiceType, number>  // 종목별 TC 수
  time_minutes_total: number
}

export type StaffDailyAggregate = {
  store_uuid: string
  business_date: string
  rows: StaffDailyRow[]            // hostess 1명당 1행
  total_tc: number                 // rows.tc_count 합
  total_payout_won: number         // rows.total_payout_won 합
  has_data: boolean
}

type ParticipantRow = {
  id: string
  membership_id: string | null
  external_name: string | null
  origin_store_uuid: string | null
  category: string | null
  time_minutes: number | null
  hostess_payout_amount: number | null
  role: string
  status: string | null
}

const SERVICE_KEYS: ServiceType[] = ["퍼블릭", "셔츠", "하퍼"]

function emptyByCategory(): Record<ServiceType, number> {
  return { 퍼블릭: 0, 셔츠: 0, 하퍼: 0 }
}

function normalizeServiceType(c: string | null): ServiceType | null {
  if (!c) return null
  if (SERVICE_KEYS.includes(c as ServiceType)) return c as ServiceType
  return null
}

/**
 * 매장 1일치 staff 집계.
 *
 * 호출자: /api/reconcile/[id]/diff (staff sheet_kind 일 때).
 */
export async function aggregateStaffForDay(
  supabase: SupabaseClient,
  store_uuid: string,
  business_date: string,
): Promise<StaffDailyAggregate> {
  const empty: StaffDailyAggregate = {
    store_uuid, business_date,
    rows: [], total_tc: 0, total_payout_won: 0, has_data: false,
  }

  // 1) business_day_id lookup (없을 수도 있음 — 그 경우 빈 결과)
  const { data: bdRow } = await supabase
    .from("store_operating_days")
    .select("id")
    .eq("store_uuid", store_uuid)
    .eq("business_date", business_date)
    .maybeSingle()
  const business_day_id = (bdRow as { id?: string } | null)?.id ?? null
  if (!business_day_id) return empty

  // 2) 그날의 sessions (이 매장)
  const { data: sessions } = await supabase
    .from("room_sessions")
    .select("id")
    .eq("store_uuid", store_uuid)
    .eq("business_day_id", business_day_id)
  const sessionIds = ((sessions ?? []) as { id: string }[]).map((s) => s.id)
  if (sessionIds.length === 0) return empty

  // 3) participants (role='hostess', not deleted)
  const { data: parts } = await supabase
    .from("session_participants")
    .select("id, membership_id, external_name, origin_store_uuid, category, time_minutes, hostess_payout_amount, role, status")
    .eq("store_uuid", store_uuid)
    .eq("role", "hostess")
    .is("deleted_at", null)
    .in("session_id", sessionIds)
  const partRows = (parts ?? []) as ParticipantRow[]
  if (partRows.length === 0) return empty

  // 4) hostess 이름 매핑 (membership_id 가 있는 row 만)
  const memIds = Array.from(new Set(partRows.map((p) => p.membership_id).filter((x): x is string => !!x)))
  const nameMap = new Map<string, string>()
  if (memIds.length > 0) {
    const { data: hsts } = await supabase
      .from("hostesses")
      .select("membership_id, name")
      .eq("store_uuid", store_uuid)
      .in("membership_id", memIds)
    for (const h of (hsts ?? []) as { membership_id: string; name: string }[]) {
      nameMap.set(h.membership_id, h.name)
    }
  }

  // 5) origin_store 이름 매핑
  const originIds = Array.from(new Set(
    partRows.map((p) => p.origin_store_uuid).filter((x): x is string => !!x && x !== store_uuid),
  ))
  const originNameMap = new Map<string, string>()
  if (originIds.length > 0) {
    const { data: stores } = await supabase
      .from("stores")
      .select("id, store_name")
      .in("id", originIds)
    for (const s of (stores ?? []) as { id: string; store_name: string }[]) {
      originNameMap.set(s.id, s.store_name)
    }
  }

  // 6) 그룹핑 — membership_id 가 있으면 그것 기준, 없으면 external_name 기준
  type Bucket = StaffDailyRow
  const byKey = new Map<string, Bucket>()
  for (const p of partRows) {
    const key = p.membership_id ?? `ext::${p.external_name ?? "unknown"}`
    const displayName = p.membership_id
      ? (nameMap.get(p.membership_id) ?? "(이름미상)")
      : (p.external_name ?? "(외부 게스트)")
    const origin = p.origin_store_uuid && p.origin_store_uuid !== store_uuid
      ? (originNameMap.get(p.origin_store_uuid) ?? null)
      : null
    let b = byKey.get(key)
    if (!b) {
      b = {
        membership_id: p.membership_id,
        name: displayName,
        origin_store: origin,
        tc_count: 0,
        total_payout_won: 0,
        by_category: emptyByCategory(),
        time_minutes_total: 0,
      }
      byKey.set(key, b)
    }
    b.tc_count += 1
    b.total_payout_won += Number(p.hostess_payout_amount ?? 0)
    b.time_minutes_total += Number(p.time_minutes ?? 0)
    const sv = normalizeServiceType(p.category)
    if (sv) b.by_category[sv] += 1
  }

  const rows = Array.from(byKey.values()).sort((a, b) => b.tc_count - a.tc_count)
  const total_tc = rows.reduce((s, r) => s + r.tc_count, 0)
  const total_payout_won = rows.reduce((s, r) => s + r.total_payout_won, 0)

  return {
    store_uuid, business_date,
    rows,
    total_tc,
    total_payout_won,
    has_data: rows.length > 0,
  }
}
