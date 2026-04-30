/**
 * R-paper-to-manager (2026-04-30): 종이장부 staff sheet 의 manager_membership_id
 * 매핑을 실장 정산 (`/api/manager/ledger`) 에 합산.
 *
 * 흐름:
 *   1. 월 범위 (year_month) 의 paper_ledger_snapshots (sheet_kind='staff') 조회.
 *   2. 각 snapshot 의 latest paper_ledger_edits 가져옴.
 *      edit 가 없으면 latest extraction 사용 (편집 전 원본은 운영자가
 *      manager 매핑 안 했으므로 보통 manager_membership_id 없음 → 0 row).
 *   3. edited_json.staff[] 순회. row.manager_membership_id === target 이면
 *      그 hostess 의 daily_totals 와 sessions 를 manager 의 paper-source
 *      수익으로 합산.
 *
 * 정책:
 *   - daily_totals[0] = 총갯수 (TC count) → tc_count 합
 *   - daily_totals[1] = 줄돈 → owe_won (가게 별 정산금) 으로 분류
 *   - DB session_participants 와 분리해서 별도 section 으로 노출 →
 *     이중 계산 방지. 운영자가 두 source 를 비교 가능.
 *
 * 호출:
 *   const paper = await aggregateManagerPaperLedger(supabase, {
 *     store_uuid, manager_membership_id, year_month
 *   })
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import type { PaperExtraction, PaperStaffRow } from "@/lib/reconcile/types"

export type ManagerPaperRow = {
  business_date: string
  hostess_name: string
  tc_count: number
  owe_won: number
  source_snapshot_id: string
}

export type ManagerPaperAggregate = {
  rows: ManagerPaperRow[]
  total_tc: number
  total_owe_won: number
  by_hostess: Array<{
    hostess_name: string
    tc_count: number
    owe_won: number
    days: number
  }>
}

const EMPTY: ManagerPaperAggregate = {
  rows: [],
  total_tc: 0,
  total_owe_won: 0,
  by_hostess: [],
}

export async function aggregateManagerPaperLedger(
  supabase: SupabaseClient,
  input: {
    store_uuid: string
    manager_membership_id: string
    /** "YYYY-MM" */
    year_month: string
  },
): Promise<ManagerPaperAggregate> {
  const m = input.year_month.match(/^(\d{4})-(\d{2})$/)
  if (!m) return EMPTY
  const [, y, mm] = m
  const start = `${y}-${mm}-01`
  const lastDay = new Date(Date.UTC(parseInt(y, 10), parseInt(mm, 10), 0)).getUTCDate()
  const end = `${y}-${mm}-${String(lastDay).padStart(2, "0")}`

  // 1. 월 범위의 staff snapshots
  const { data: snaps } = await supabase
    .from("paper_ledger_snapshots")
    .select("id, business_date")
    .eq("store_uuid", input.store_uuid)
    .eq("sheet_kind", "staff")
    .is("archived_at", null)
    .gte("business_date", start)
    .lte("business_date", end)

  const snapList = (snaps ?? []) as { id: string; business_date: string }[]
  if (snapList.length === 0) return EMPTY

  const snapIds = snapList.map((s) => s.id)
  const dateMap = new Map(snapList.map((s) => [s.id, s.business_date]))

  // 2. 각 snapshot 의 latest edit (edit 우선, 없으면 extraction)
  const { data: edits } = await supabase
    .from("paper_ledger_edits")
    .select("snapshot_id, edited_json, edited_at")
    .in("snapshot_id", snapIds)
    .order("edited_at", { ascending: false })

  const latestEditBySnap = new Map<string, PaperExtraction>()
  for (const e of (edits ?? []) as { snapshot_id: string; edited_json: PaperExtraction }[]) {
    if (!latestEditBySnap.has(e.snapshot_id)) {
      latestEditBySnap.set(e.snapshot_id, e.edited_json)
    }
  }

  // edit 가 없는 snapshot 은 latest extraction 사용 (manager 매핑 가능성
  //   낮지만 일관성 위해 fallback)
  const missingSnapIds = snapIds.filter((id) => !latestEditBySnap.has(id))
  if (missingSnapIds.length > 0) {
    const { data: exts } = await supabase
      .from("paper_ledger_extractions")
      .select("snapshot_id, extracted_json, created_at")
      .in("snapshot_id", missingSnapIds)
      .order("created_at", { ascending: false })
    for (const x of (exts ?? []) as { snapshot_id: string; extracted_json: PaperExtraction }[]) {
      if (!latestEditBySnap.has(x.snapshot_id)) {
        latestEditBySnap.set(x.snapshot_id, x.extracted_json)
      }
    }
  }

  // 3. 각 row.manager_membership_id 가 target 매니저인 row 만 합산
  const rows: ManagerPaperRow[] = []
  const byHostess = new Map<string, { tc_count: number; owe_won: number; days: Set<string> }>()

  for (const [snapId, json] of latestEditBySnap) {
    const businessDate = dateMap.get(snapId) ?? ""
    const staff = (json?.staff ?? []) as PaperStaffRow[]
    for (const row of staff) {
      if (row.manager_membership_id !== input.manager_membership_id) continue
      const tc = Number(row.daily_totals?.[0] ?? 0)
      const owe = Number(row.daily_totals?.[1] ?? 0)
      if (tc === 0 && owe === 0) continue
      const name = row.hostess_name || "(이름미상)"
      rows.push({
        business_date: businessDate,
        hostess_name: name,
        tc_count: tc,
        owe_won: owe,
        source_snapshot_id: snapId,
      })
      let bucket = byHostess.get(name)
      if (!bucket) {
        bucket = { tc_count: 0, owe_won: 0, days: new Set<string>() }
        byHostess.set(name, bucket)
      }
      bucket.tc_count += tc
      bucket.owe_won += owe
      if (businessDate) bucket.days.add(businessDate)
    }
  }

  const total_tc = rows.reduce((s, r) => s + r.tc_count, 0)
  const total_owe_won = rows.reduce((s, r) => s + r.owe_won, 0)
  const by_hostess = Array.from(byHostess.entries())
    .map(([name, b]) => ({
      hostess_name: name,
      tc_count: b.tc_count,
      owe_won: b.owe_won,
      days: b.days.size,
    }))
    .sort((a, b) => b.tc_count - a.tc_count)

  return { rows, total_tc, total_owe_won, by_hostess }
}
