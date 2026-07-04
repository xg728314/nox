/**
 * 마블 매장 ↔ 시뮬 매장 cross-store 거래 시드.
 *
 * 효과: 사용자가 본인 마블 계정으로 로그인했을 때
 *   - /m/settle 의 "줄 돈" 탭에 시뮬 매장 거래 보임
 *   - 매장간 정산 매트릭스에 시뮬 매장 표시
 *   - 마블 매장 룸 활용도 +5건
 *
 * 시나리오: 시뮬 매장 5명의 아가씨가 마블 매장에서 일함 (cross-store).
 *   → 마블이 매출 (gross_total) 받고, 시뮬 매장에 정산 줘야 함.
 *
 * 멱등: 재실행 시 기존 cross-store 시뮬 세션 보존, 추가만 진행.
 */
import { createClient } from "@supabase/supabase-js"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

const log = (...a: unknown[]) => console.log("[cross-store]", ...a)

const SOURCE_SIM_STORES = ["5층-A", "5층-B", "5층-C", "5층-D", "6층-A"] // 시뮬 매장 5개

async function main() {
  // 1. 마블 매장
  const { data: marvel } = await sb
    .from("stores")
    .select("id, store_name, floor")
    .like("store_name", "%마블%")
    .maybeSingle()
  if (!marvel) throw new Error("마블 매장을 찾을 수 없음")
  log("마블:", marvel.id)

  // 2. 마블 룸
  const { data: marvelRooms } = await sb
    .from("rooms")
    .select("id, room_no")
    .eq("store_uuid", marvel.id)
    .eq("is_active", true)
    .limit(SOURCE_SIM_STORES.length)
  if (!marvelRooms?.length) throw new Error("마블 룸 없음")
  log("마블 룸:", marvelRooms.length)

  // 3. 마블 매장 실장 1명 (cross-store 세션을 개설할 사람)
  const { data: marvelMgr } = await sb
    .from("store_memberships")
    .select("id, profile_id")
    .eq("store_uuid", marvel.id)
    .eq("role", "manager")
    .eq("status", "approved")
    .is("deleted_at", null)
    .limit(1)
    .single()
  if (!marvelMgr) throw new Error("마블 실장 없음")
  log("마블 실장:", marvelMgr.id)

  // 4. 오늘 마블 영업일
  const today = new Date().toISOString().slice(0, 10)
  let { data: bizDay } = await sb
    .from("store_operating_days")
    .select("id")
    .eq("store_uuid", marvel.id)
    .eq("business_date", today)
    .maybeSingle()
  if (!bizDay) {
    const { data, error } = await sb
      .from("store_operating_days")
      .insert({ store_uuid: marvel.id, business_date: today, status: "open", opened_by: marvelMgr.profile_id })
      .select("id")
      .single()
    if (error || !data) throw new Error(`bizDay 생성: ${error?.message}`)
    bizDay = data
  }

  // 5. 시뮬 5개 매장 각 1명 아가씨 picking
  let added = 0
  for (let i = 0; i < SOURCE_SIM_STORES.length; i++) {
    const simLabel = SOURCE_SIM_STORES[i]
    const room = marvelRooms[i]
    if (!room) continue

    const { data: simStore } = await sb
      .from("stores")
      .select("id, store_name")
      .eq("store_name", `[시뮬] ${simLabel}`)
      .maybeSingle()
    if (!simStore) {
      log(`  ${simLabel} 매장 없음, skip`)
      continue
    }

    // 시뮬 매장 아가씨 1명
    const { data: hostess } = await sb
      .from("store_memberships")
      .select("id, profile_id")
      .eq("store_uuid", simStore.id)
      .eq("role", "hostess")
      .eq("status", "approved")
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .single()
    if (!hostess) {
      log(`  ${simLabel} 아가씨 없음, skip`)
      continue
    }

    // 마블 룸에 cross-store 세션 active 로 생성
    const startedAt = new Date()
    startedAt.setHours(20 + i, 30 + i * 5, 0, 0)
    const { data: session, error: sErr } = await sb
      .from("room_sessions")
      .insert({
        store_uuid: marvel.id,
        room_uuid: room.id,
        business_day_id: bizDay.id,
        status: "active",
        opened_by: marvelMgr.profile_id,
        manager_membership_id: marvelMgr.id,
        manager_name: "마블 실장",
        is_external_manager: false,
        started_at: startedAt.toISOString(),
      })
      .select("id")
      .single()
    if (sErr || !session) {
      log(`  세션 생성 실패 (${simLabel}):`, sErr?.message)
      continue
    }

    // 참여자 — origin_store_uuid 가 시뮬 매장 (= cross-store)
    const category = i % 3 === 0 ? "셔츠" : i % 3 === 1 ? "하퍼" : "퍼블릭"
    const price = category === "셔츠" ? 140000 : category === "하퍼" ? 120000 : 130000
    const timeMinutes = category === "셔츠" ? 60 : category === "하퍼" ? 60 : 90
    const managerDeduction = 5000

    // transfer_request 먼저 — cross-store 참여 트리거가 필수로 요구
    const { data: tr, error: trErr } = await sb
      .from("transfer_requests")
      .insert({
        hostess_membership_id: hostess.id,
        from_store_uuid: simStore.id,
        to_store_uuid: marvel.id,
        status: "approved",
        reason: "[cross-store seed] 시뮬→마블 자동 이적",
      })
      .select("id")
      .single()
    if (trErr || !tr) {
      log(`  transfer_request 실패 (${simLabel}):`, trErr?.message)
      continue
    }

    const { error: pErr } = await sb.from("session_participants").insert({
      session_id: session.id,
      membership_id: hostess.id,
      role: "hostess",
      category,
      time_minutes: timeMinutes,
      price_amount: price,
      manager_payout_amount: managerDeduction,
      hostess_payout_amount: price - managerDeduction,
      margin_amount: 0,
      cha3_amount: 0,
      banti_amount: 0,
      waiter_tip_received: false,
      waiter_tip_amount: 0,
      greeting_confirmed: category === "셔츠",
      status: "active",
      store_uuid: marvel.id, // 일한 매장 = 마블
      origin_store_uuid: simStore.id, // 원소속 = 시뮬 매장 (cross-store 표식)
      transfer_request_id: tr.id,
      entered_at: startedAt.toISOString(),
      manager_membership_id: marvelMgr.id,
    })
    if (pErr) {
      log(`  참여자 실패 (${simLabel}):`, pErr.message)
      continue
    }

    // receipts (마블 매장 finalize)
    const { error: rErr } = await sb.from("receipts").insert({
      store_uuid: marvel.id,
      session_id: session.id,
      business_day_id: bizDay.id,
      status: "finalized",
      gross_total: price,
      order_total_amount: 0,
      participant_total_amount: price,
      tc_amount: price,
      manager_amount: managerDeduction,
      hostess_amount: price - managerDeduction,
      margin_amount: 0,
      card_fee_amount: 0,
      payment_method: i % 2 === 0 ? "cash" : "card",
      finalized_at: new Date().toISOString(),
      finalized_by: marvelMgr.profile_id,
    })
    if (rErr) log(`  receipt 실패 (${simLabel}):`, rErr.message)

    // 세션 closed
    await sb
      .from("room_sessions")
      .update({ status: "closed", ended_at: new Date(startedAt.getTime() + timeMinutes * 60_000).toISOString() })
      .eq("id", session.id)

    // cross_store_work_records 보조 row (선택적, 매장간 정산 매트릭스용)
    await sb.from("cross_store_work_records").insert({
      session_id: session.id,
      hostess_membership_id: hostess.id,
      working_store_uuid: marvel.id,
      origin_store_uuid: simStore.id,
      status: "approved",
      gross_amount: price,
    }).then(({ error }) => {
      if (error) log(`  cswr 실패 (${simLabel}): ${error.message} (정산엔 영향 없음)`)
    })

    log(`  ✓ ${simLabel} → 마블 (${room.room_no}, ${category} ${timeMinutes}분, ${price.toLocaleString()}원)`)
    added++
  }

  log(`\n=== 완료: cross-store 세션 ${added}건 추가 ===`)
  log("이제 본인 마블 계정으로 로그인 → 정산 → 매장간 정산에 시뮬 매장 거래 표시됨")
}

main().catch((e) => {
  console.error("[cross-store] FATAL:", e)
  process.exit(1)
})
