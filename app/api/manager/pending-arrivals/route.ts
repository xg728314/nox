/**
 * GET /api/manager/pending-arrivals
 *
 * 본 매장 (auth.store_uuid) 에 dispatch 되었으나 아직 방 배정 안 된 아가씨 목록.
 *   기준: transfer_requests where to_store_uuid = 본 매장, status = approved,
 *         business_day_id = 오늘 · session_participants 에 아직 등록 안됨.
 *
 * 응답:
 *   {
 *     count: N,
 *     items: [
 *       {
 *         transfer_request_id,
 *         hostess_membership_id, hostess_name,
 *         origin_store_uuid, origin_store_name,
 *         origin_manager_name,
 *         category, time_type,           // reason JSON 파싱
 *         dispatched_at, requested_at
 *       }
 *     ]
 *   }
 *
 * R-pending-pool (2026-08-31): cross-store/dispatch mode="pending" 로 생성된
 *   요청 목록을 도착 매장 UI (조판 홈 배지) 에 노출하기 위한 endpoint.
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { getBusinessDateForOps } from "@/lib/time/businessDate"

type Metadata = { category?: string; time_type?: string; dispatched_by?: string | null; dispatched_at?: string }

function parseMetadata(reason: string | null): Metadata {
  if (!reason) return {}
  try {
    const j = JSON.parse(reason)
    if (typeof j === "object" && j !== null) return j as Metadata
  } catch { /* legacy plain-text reason */ }
  return {}
}

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner" && auth.role !== "manager") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }
    const supabase = getServiceClient()

    // 1. 영업일 — settlementSummary 와 동일한 fallback
    const today = getBusinessDateForOps()
    const { data: bizDayToday } = await supabase
      .from("store_operating_days")
      .select("id, business_date")
      .eq("store_uuid", auth.store_uuid)
      .eq("business_date", today)
      .maybeSingle()
    let businessDayId: string | null = (bizDayToday as { id: string } | null)?.id ?? null
    if (!businessDayId) {
      const { data: latestDay } = await supabase
        .from("store_operating_days")
        .select("id, business_date")
        .eq("store_uuid", auth.store_uuid)
        .eq("status", "open")
        .order("business_date", { ascending: false })
        .limit(1)
        .maybeSingle()
      businessDayId = (latestDay as { id: string } | null)?.id ?? null
    }
    if (!businessDayId) {
      return NextResponse.json({ count: 0, items: [] })
    }

    // 2. 오늘 approved 요청 (to = 본 매장)
    const { data: trs } = await supabase
      .from("transfer_requests")
      .select("id, hostess_membership_id, from_store_uuid, reason, created_at, from_store_approved_at")
      .eq("to_store_uuid", auth.store_uuid)
      .eq("status", "approved")
      .eq("business_day_id", businessDayId)
      .order("created_at", { ascending: false })
    const trsAll = (trs ?? []) as Array<{
      id: string; hostess_membership_id: string; from_store_uuid: string;
      reason: string | null; created_at: string; from_store_approved_at: string | null
    }>
    if (trsAll.length === 0) {
      return NextResponse.json({ count: 0, items: [] })
    }

    // 3. 이미 참여자로 등록된 transfer_request 제외
    const trIds = trsAll.map((t) => t.id)
    const { data: usedRows } = await supabase
      .from("session_participants")
      .select("transfer_request_id")
      .in("transfer_request_id", trIds)
      .is("deleted_at", null)
    const usedSet = new Set(((usedRows ?? []) as Array<{ transfer_request_id: string | null }>)
      .map((r) => r.transfer_request_id).filter(Boolean) as string[])
    const pending = trsAll.filter((t) => !usedSet.has(t.id))
    if (pending.length === 0) {
      return NextResponse.json({ count: 0, items: [] })
    }

    // 4. 이름/매장/매니저 매핑
    const hostessMids = Array.from(new Set(pending.map((t) => t.hostess_membership_id)))
    const originStoreIds = Array.from(new Set(pending.map((t) => t.from_store_uuid)))

    const [hostessRes, storeRes] = await Promise.all([
      supabase.from("hostesses").select("membership_id, name, manager_membership_id").in("membership_id", hostessMids),
      supabase.from("stores").select("id, store_name").in("id", originStoreIds),
    ])
    type HostessRow = { membership_id: string; name: string | null; manager_membership_id: string | null }
    const hostessMap = new Map<string, HostessRow>()
    for (const h of ((hostessRes.data ?? []) as HostessRow[])) hostessMap.set(h.membership_id, h)
    const storeMap = new Map<string, string>()
    for (const s of ((storeRes.data ?? []) as { id: string; store_name: string }[])) storeMap.set(s.id, s.store_name)

    // 5. 원소속 실장 이름 lookup
    const originMgrMids = Array.from(new Set(
      [...hostessMap.values()].map((h) => h.manager_membership_id).filter(Boolean) as string[]
    ))
    const mgrNameByMid = new Map<string, string>()
    if (originMgrMids.length > 0) {
      const { data: memRows } = await supabase
        .from("store_memberships")
        .select("id, profiles!store_memberships_profile_id_fkey(full_name)")
        .in("id", originMgrMids)
      type MemEmbed = { id: string; profiles: { full_name: string } | { full_name: string }[] | null }
      for (const m of ((memRows ?? []) as MemEmbed[])) {
        const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles
        if (p?.full_name) mgrNameByMid.set(m.id, p.full_name)
      }
    }

    // 6. 조립
    const items = pending.map((t) => {
      const meta = parseMetadata(t.reason)
      const h = hostessMap.get(t.hostess_membership_id)
      return {
        transfer_request_id: t.id,
        hostess_membership_id: t.hostess_membership_id,
        hostess_name: h?.name ?? "?",
        origin_store_uuid: t.from_store_uuid,
        origin_store_name: storeMap.get(t.from_store_uuid) ?? "?",
        origin_manager_name: h?.manager_membership_id ? (mgrNameByMid.get(h.manager_membership_id) ?? null) : null,
        category: meta.category ?? null,
        time_type: meta.time_type ?? null,
        dispatched_at: meta.dispatched_at ?? t.created_at,
        requested_at: t.from_store_approved_at ?? t.created_at,
      }
    })

    return NextResponse.json({ count: items.length, items })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.type, message: error.message }, { status: error.status })
    }
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: (error as Error).message },
      { status: 500 },
    )
  }
}
