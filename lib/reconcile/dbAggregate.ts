/**
 * R29: 종이장부 비교 대상이 되는 NOX DB 측 그날 집계.
 *
 * 출력은 PaperTotals 와 같은 모양 — 비교 코드가 양쪽을 동일 shape 로 다룸.
 *
 * 매장 스코프:
 *   - 호출자가 store_uuid 를 검증한 후 호출.
 *   - 이 함수는 store_uuid + business_date 만으로 조회 (auth 검증 X).
 *
 * 집계 항목:
 *   - cross_store_owe / recv: cross_store_settlements 또는 같은 의미 테이블에서.
 *     스키마가 신뢰할 수 없으면 fallback 으로 빈 객체 반환 (diff 가 'no_db_data' 됨).
 *   - liquor_total: orders 의 양주 카테고리 합.
 *   - misu_total: credits 의 unpaid 합.
 */

import type { SupabaseClient } from "@supabase/supabase-js"

export type DbAggregate = {
  store_uuid: string
  business_date: string
  owe_by_store: Record<string, number>      // 우리가 줄 돈 (외부 origin_store 별)
  recv_by_store: Record<string, number>     // 우리가 받을 돈 (우리 아가씨가 외부 매장에서 일한 정산)
  owe_total_won: number
  recv_total_won: number
  liquor_total_won: number
  misu_total_won: number
  has_data: boolean                          // 그날 row 가 하나라도 있었는지
}

export async function aggregateDbForDay(
  supabase: SupabaseClient,
  store_uuid: string,
  business_date: string,
): Promise<DbAggregate> {
  const empty: DbAggregate = {
    store_uuid, business_date,
    owe_by_store: {}, recv_by_store: {},
    owe_total_won: 0, recv_total_won: 0,
    liquor_total_won: 0, misu_total_won: 0,
    has_data: false,
  }

  // 1) business_day_id lookup
  const { data: bdRow } = await supabase
    .from("store_operating_days")
    .select("id")
    .eq("store_uuid", store_uuid)
    .eq("business_date", business_date)
    .maybeSingle()
  const business_day_id = (bdRow as { id?: string } | null)?.id ?? null

  // 2) 외상 (credits) — unpaid 합
  let misu = 0
  try {
    const q = supabase
      .from("credits")
      .select("amount, status, business_day_id, business_date")
      .eq("store_uuid", store_uuid)
    const { data: creditRows } = business_day_id
      ? await q.eq("business_day_id", business_day_id)
      : await q.eq("business_date", business_date)
    for (const r of creditRows ?? []) {
      const row = r as { amount?: number | string; status?: string }
      if (row.status === "unpaid" || row.status === "open" || row.status === "active") {
        misu += toNum(row.amount)
      }
    }
  } catch { /* schema 차이 — best-effort */ }

  // 3) 양주 합계 — orders 에서 카테고리/이름이 양주류인 것
  let liquor = 0
  try {
    let q = supabase
      .from("orders")
      .select("amount, total_amount, category, name, business_day_id, business_date")
      .eq("store_uuid", store_uuid)
    if (business_day_id) {
      q = q.eq("business_day_id", business_day_id)
    } else {
      q = q.eq("business_date", business_date)
    }
    const { data: orderRows } = await q
    for (const r of orderRows ?? []) {
      const row = r as { amount?: number | string; total_amount?: number | string; category?: string; name?: string }
      if (looksLikeLiquor(row.category) || looksLikeLiquor(row.name)) {
        liquor += toNum(row.total_amount ?? row.amount)
      }
    }
  } catch { /* best-effort */ }

  // 4) cross-store 정산 — 매장별 group by
  const owe_by_store: Record<string, number> = {}
  const recv_by_store: Record<string, number> = {}

  // 4a. 우리 매장에 와서 일한 외부 staff (origin_store != our store) → 줄돈
  // 4b. 우리 staff 가 다른 매장에서 일함 → 받돈
  try {
    let q = supabase
      .from("cross_store_settlements")
      .select("origin_store_uuid, work_store_uuid, amount, total_amount, business_day_id, business_date")
    if (business_day_id) {
      q = q.eq("business_day_id", business_day_id)
    } else {
      q = q.eq("business_date", business_date)
    }
    const { data: rows } = await q
    if (Array.isArray(rows)) {
      // 매장 이름 매핑 — origin_store_uuid → store_name
      const storeIds = new Set<string>()
      for (const r of rows) {
        const row = r as { origin_store_uuid?: string; work_store_uuid?: string }
        if (row.origin_store_uuid) storeIds.add(row.origin_store_uuid)
        if (row.work_store_uuid) storeIds.add(row.work_store_uuid)
      }
      const storeNameMap = await loadStoreNames(supabase, [...storeIds])

      for (const r of rows) {
        const row = r as {
          origin_store_uuid?: string
          work_store_uuid?: string
          amount?: number | string
          total_amount?: number | string
        }
        const amt = toNum(row.total_amount ?? row.amount)
        if (amt <= 0) continue
        if (row.work_store_uuid === store_uuid && row.origin_store_uuid && row.origin_store_uuid !== store_uuid) {
          // 외부 staff 가 우리 매장에서 일함 → 우리가 origin store 에 줘야 함 (줄돈)
          const name = storeNameMap[row.origin_store_uuid] ?? row.origin_store_uuid
          owe_by_store[name] = (owe_by_store[name] ?? 0) + amt
        } else if (row.origin_store_uuid === store_uuid && row.work_store_uuid && row.work_store_uuid !== store_uuid) {
          // 우리 staff 가 외부 매장에서 일함 → 받돈
          const name = storeNameMap[row.work_store_uuid] ?? row.work_store_uuid
          recv_by_store[name] = (recv_by_store[name] ?? 0) + amt
        }
      }
    }
  } catch { /* best-effort — 테이블/컬럼 미존재 */ }

  const owe_total_won = sumValues(owe_by_store)
  const recv_total_won = sumValues(recv_by_store)
  const has_data = misu > 0 || liquor > 0 || owe_total_won > 0 || recv_total_won > 0

  return {
    ...empty,
    owe_by_store, recv_by_store,
    owe_total_won, recv_total_won,
    liquor_total_won: liquor,
    misu_total_won: misu,
    has_data,
  }
}

function toNum(v: unknown): number {
  if (v === null || v === undefined) return 0
  const n = typeof v === "string" ? Number(v) : (v as number)
  return Number.isFinite(n) ? n : 0
}

function sumValues(o: Record<string, number>): number {
  let s = 0
  for (const v of Object.values(o)) s += v
  return s
}

function looksLikeLiquor(s: string | undefined | null): boolean {
  if (!s) return false
  const x = s.toLowerCase()
  return /양주|whisky|whiskey|위스키|골든|블루|saint|발렌|발리/i.test(s) ||
    x.includes("liquor")
}

async function loadStoreNames(
  supabase: SupabaseClient,
  ids: string[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  if (ids.length === 0) return out
  try {
    const { data } = await supabase
      .from("stores")
      .select("id, store_name")
      .in("id", ids)
    for (const r of data ?? []) {
      const row = r as { id: string; store_name: string }
      out[row.id] = row.store_name
    }
  } catch { /* best-effort */ }
  return out
}
