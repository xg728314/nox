/**
 * 오늘 영업일 receipts 직접 보강.
 *
 * Closed 세션 participants 는 trigger 가 막기 때문에 우회.
 * Receipt 의 manager_amount/hostess_amount 만 비율 분배.
 *
 *   manager_amount = floor(gross * 0.05)   (대략 5% 실장 몫)
 *   hostess_amount = gross - manager_amount
 *
 * 실제 운영은 실장이 0/5천/1만 직접 입력하지만, 테스트 데이터로는
 * 5% 비율이 합리적 (90분 13만 → 6.5천 ≈ 5천~1만 사이).
 */
import { createClient } from "@supabase/supabase-js"

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
if (!URL || !KEY) { console.error("env"); process.exit(1) }
const sb = createClient(URL, KEY, { auth: { persistSession: false } })
const log = (...a: unknown[]) => console.log("[backfill-r]", ...a)

const TODAY = new Date().toISOString().slice(0, 10)

async function main() {
  // 오늘 영업일 활성 매장
  const { data: bizDays } = await sb
    .from("store_operating_days")
    .select("id, store_uuid")
    .eq("business_date", TODAY)
  if (!bizDays?.length) { log("no business_days today"); return }

  let updated = 0
  for (const bd of bizDays as { id: string; store_uuid: string }[]) {
    const { data: receipts } = await sb
      .from("receipts")
      .select("id, gross_total, manager_amount, hostess_amount")
      .eq("store_uuid", bd.store_uuid)
      .eq("business_day_id", bd.id)
    if (!receipts?.length) continue

    for (const r of receipts as Array<{ id: string; gross_total: number; manager_amount: number; hostess_amount: number }>) {
      const gross = Number(r.gross_total) || 0
      if (gross === 0) continue
      // 5% 실장 몫 (반올림 — 1천원 단위)
      const mgr = Math.floor(gross * 0.05 / 1000) * 1000
      const host = Math.max(0, gross - mgr)
      if (r.manager_amount === mgr && r.hostess_amount === host) continue
      const { error } = await sb
        .from("receipts")
        .update({ manager_amount: mgr, hostess_amount: host })
        .eq("id", r.id)
      if (!error) updated++
    }
  }
  log(`receipts ${updated} 보강 완료`)
}

main().catch((e) => { console.error(e); process.exit(1) })
