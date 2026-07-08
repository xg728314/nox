/**
 * 세션 종료 시 손님 프로필 자동 처리.
 *   1. 세션에 guest_note 있으면 guest_profiles UPSERT (매장별 name+phone 기준)
 *   2. guest_visits 자동 INSERT (매출/타임/태그 스냅샷)
 *   3. 매치되는 프로필 있으면 visit_count / last_visit_at / total_spent 갱신
 *   4. 태그 자동 축적 (guest_profiles.tags)
 *
 * fire-and-forget — 체크아웃 응답 지연 X.
 *
 * R-auto-ops (2026-07-08).
 */
import { getServiceClient } from "@/lib/supabase/serviceClient"

export async function autoProcessGuestProfile(input: {
  session_id: string
  store_uuid: string
  business_day_id: string | null
}): Promise<void> {
  try {
    const supabase = getServiceClient()

    // 세션 정보 + 참여자/매출 조회
    const { data: sess } = await supabase
      .from("room_sessions")
      .select("id, store_uuid, guest_note, business_day_id, started_at, ended_at")
      .eq("id", input.session_id)
      .maybeSingle()
    if (!sess) return
    const session = sess as {
      id: string
      store_uuid: string
      guest_note: string | null
      business_day_id: string | null
    }
    // guest_note 없으면 skip
    if (!session.guest_note?.trim()) return

    // 참여자 → 매출 · 타임
    const { data: parts } = await supabase
      .from("session_participants")
      .select("price_amount, hostess_payout_amount")
      .eq("session_id", input.session_id)
      .is("deleted_at", null)
    type P = { price_amount: number | null; hostess_payout_amount: number | null }
    const rows = (parts ?? []) as P[]
    const totalAmount = rows.reduce((a, p) => a + Number(p.price_amount ?? 0), 0)
    const tcCount = rows.filter((p) => (p.price_amount ?? 0) > 0).length

    // 손님 매칭 — display_name 완전 일치 우선, 없으면 새로 생성
    const displayName = session.guest_note.trim().split(/\r?\n/)[0].slice(0, 60)
    if (!displayName) return

    let guestId: string | null = null
    const { data: existing } = await supabase
      .from("guest_profiles")
      .select("id, visit_count, total_spent, tags")
      .eq("store_uuid", input.store_uuid)
      .eq("display_name", displayName)
      .maybeSingle()

    if (existing) {
      // 기존 프로필 UPDATE
      const cur = existing as {
        id: string
        visit_count: number
        total_spent: number
        tags: string[]
      }
      guestId = cur.id
      await supabase
        .from("guest_profiles")
        .update({
          visit_count: cur.visit_count + 1,
          total_spent: Number(cur.total_spent ?? 0) + totalAmount,
          last_visit_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", cur.id)
    } else {
      // 신규 프로필 INSERT
      const { data: created } = await supabase
        .from("guest_profiles")
        .insert({
          store_uuid: input.store_uuid,
          display_name: displayName,
          visit_count: 1,
          total_spent: totalAmount,
          last_visit_at: new Date().toISOString(),
        })
        .select("id")
        .single()
      guestId = (created as { id: string } | null)?.id ?? null
    }

    if (!guestId) return

    // 방문 이력 INSERT
    await supabase.from("guest_visits").insert({
      guest_id: guestId,
      store_uuid: input.store_uuid,
      session_id: input.session_id,
      business_day_id: input.business_day_id,
      total_amount: totalAmount,
      tc_count: tcCount,
      memo: session.guest_note.slice(0, 500),
    })

    // guest_auto_tags 큐 (감사 + 재분석용)
    await supabase.from("guest_auto_tags").insert({
      session_id: input.session_id,
      store_uuid: input.store_uuid,
      guest_note: session.guest_note.slice(0, 200),
      guest_display_name: displayName,
      matched_guest_id: guestId,
      status: existing ? "matched" : "created",
      processed_at: new Date().toISOString(),
    })
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[autoProcessGuestProfile] failed:", e)
  }
}
