/**
 * 마블 + 시뮬 매장 — 오늘 영업일 participants 의 manager_payout_amount 를
 * 랜덤 (0 / 5000 / 10000) 으로 보강 + 해당 receipt 재집계.
 *
 * 효과:
 *   - /m/settle 의 "받을돈" (manager_amount) 카드에 숫자가 보임
 *   - 아가씨 hostess_payout_amount = price - 실장수익
 *   - receipt.manager_amount / hostess_amount 가 참여자 합계와 일치
 */
import { createClient } from "@supabase/supabase-js"

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
if (!URL || !KEY) {
  console.error("[backfill] env 필요"); process.exit(1)
}
const sb = createClient(URL, KEY, { auth: { persistSession: false } })
const log = (...a: unknown[]) => console.log("[backfill]", ...a)

const TODAY = new Date().toISOString().slice(0, 10)
const ONLY_TARGET_STORES = process.env.ONLY_STORES?.split(",").map((s) => s.trim()).filter(Boolean) ?? []

function pickDeduction(category: string, timeType: number): number {
  // 차3 (15분) 은 보통 0원
  if (timeType <= 15) return 0
  const r = Math.random()
  if (r < 0.4) return 0
  if (r < 0.8) return 5000
  return 10000
}

async function main() {
  // 대상 매장 — 오늘 영업일 있는 매장
  let q = sb.from("stores").select("id, store_name").eq("is_active", true).gte("floor", 5).lte("floor", 8)
  const { data: stores } = await q
  let targetStores = (stores ?? []) as { id: string; store_name: string }[]
  if (ONLY_TARGET_STORES.length > 0) {
    targetStores = targetStores.filter((s) => ONLY_TARGET_STORES.some((f) => s.store_name.includes(f)))
  }
  log(`대상 매장 ${targetStores.length}`)

  let totalUpdated = 0
  let totalReceipts = 0

  for (const store of targetStores) {
    const { data: bizDay } = await sb
      .from("store_operating_days")
      .select("id")
      .eq("store_uuid", store.id)
      .eq("business_date", TODAY)
      .maybeSingle()
    if (!bizDay) continue

    // 오늘 세션들
    const { data: sessions } = await sb
      .from("room_sessions")
      .select("id")
      .eq("store_uuid", store.id)
      .eq("business_day_id", bizDay.id)
    const sessionIds = (sessions ?? []).map((s) => s.id)
    if (sessionIds.length === 0) continue

    // participants — manager_payout_amount = 0 인 것만
    const { data: parts } = await sb
      .from("session_participants")
      .select("id, session_id, category, time_minutes, price_amount, manager_payout_amount, hostess_payout_amount")
      .eq("store_uuid", store.id)
      .in("session_id", sessionIds)
      .eq("manager_payout_amount", 0)
    if (!parts || parts.length === 0) { continue }

    log(`[${store.store_name}] participants ${parts.length} 보강`)

    for (const p of parts as Array<{
      id: string; session_id: string; category: string; time_minutes: number;
      price_amount: number; manager_payout_amount: number; hostess_payout_amount: number
    }>) {
      const newMgr = pickDeduction(p.category, p.time_minutes)
      if (newMgr === 0) continue
      const newHost = Math.max(0, (p.price_amount ?? 0) - newMgr)
      const { error } = await sb
        .from("session_participants")
        .update({ manager_payout_amount: newMgr, hostess_payout_amount: newHost })
        .eq("id", p.id)
      if (!error) totalUpdated++
    }

    // receipts 재집계 — 세션별 sum
    for (const sid of sessionIds) {
      const { data: pAll } = await sb
        .from("session_participants")
        .select("price_amount, manager_payout_amount, hostess_payout_amount")
        .eq("session_id", sid)
      if (!pAll || pAll.length === 0) continue
      const totals = pAll.reduce(
        (a, r) => ({
          gross: a.gross + (Number(r.price_amount) || 0),
          mgr: a.mgr + (Number(r.manager_payout_amount) || 0),
          host: a.host + (Number(r.hostess_payout_amount) || 0),
        }),
        { gross: 0, mgr: 0, host: 0 },
      )
      const { error: rErr } = await sb
        .from("receipts")
        .update({
          gross_total: totals.gross,
          tc_amount: totals.gross,
          participant_total_amount: totals.gross,
          manager_amount: totals.mgr,
          hostess_amount: totals.host,
        })
        .eq("session_id", sid)
      if (!rErr) totalReceipts++
    }
  }

  log(`=== 완료 — participants ${totalUpdated} 업데이트, receipts ${totalReceipts} 재집계 ===`)
}

main().catch((e) => { console.error(e); process.exit(1) })
