/**
 * /api/manager/hostesses/[hostess_id]/info
 *
 * 스태프 상세 페이지 전용 — 오늘 활동 + 정산 상태 + 지급 정보 (계좌/현금) 통합.
 *
 * GET 응답:
 *   {
 *     hostess_name,
 *     today: {
 *       business_day_id,
 *       sessions: [{ store_name, category, time_minutes, hostess_payout_amount,
 *                    status, room_name, receipt_status }],
 *       total_count, total_payout,
 *       settlement_finalized   // 오늘 모든 세션의 receipt 가 confirmed 상태인지
 *     },
 *     payout: {
 *       method: 'account' | 'cash',
 *       bank_name?, account_number?, holder_name?
 *     }
 *   }
 *
 * PATCH 입력 (전부 optional):
 *   {
 *     payout_method?: 'account' | 'cash',
 *     bank_name?, account_number?, holder_name?
 *   }
 *   계좌 정보 중 하나라도 있으면 membership_bank_accounts 의 default row 를 upsert.
 *
 * 권한:
 *   - owner / manager (manager 는 본인 담당 식구만)
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { getBusinessDateForOps } from "@/lib/time/businessDate"
import { isValidUUID } from "@/lib/validation"

type SessionRow = { id: string; room_uuid: string; status: string }
type RoomRow = { id: string; room_name: string }
type ReceiptRow = { session_id: string; status: string; version: number }
type ParticipationRow = {
  id: string
  session_id: string
  store_uuid: string
  category: string | null
  time_minutes: number | null
  price_amount: number | null
  hostess_payout_amount: number | null
  status: string
}

async function assertManagerCanView(
  supabase: ReturnType<typeof getServiceClient>,
  storeUuid: string,
  managerMembershipId: string,
  hostessMembershipId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("hostesses")
    .select("id")
    .eq("store_uuid", storeUuid)
    .eq("manager_membership_id", managerMembershipId)
    .eq("membership_id", hostessMembershipId)
    .maybeSingle()
  return !!data
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ hostess_id: string }> },
) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner" && auth.role !== "manager") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }
    const { hostess_id } = await params
    if (!hostess_id || !isValidUUID(hostess_id)) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "hostess_id (membership_id) 가 올바르지 않습니다." },
        { status: 400 },
      )
    }
    const supabase = getServiceClient()

    if (auth.role === "manager") {
      const ok = await assertManagerCanView(supabase, auth.store_uuid, auth.membership_id, hostess_id)
      if (!ok) {
        return NextResponse.json(
          { error: "NOT_ASSIGNED", message: "본인 담당 식구가 아닙니다." },
          { status: 403 },
        )
      }
    }

    // 식구 이름
    const { data: hostessInfo } = await supabase
      .from("hostesses")
      .select("name")
      .eq("store_uuid", auth.store_uuid)
      .eq("membership_id", hostess_id)
      .maybeSingle()
    const hostessName = hostessInfo?.name || ""

    // 오늘 영업일
    const today = getBusinessDateForOps()
    const { data: bizDay } = await supabase
      .from("store_operating_days")
      .select("id")
      .eq("store_uuid", auth.store_uuid)
      .eq("business_date", today)
      .maybeSingle()
    const businessDayId = bizDay?.id ?? null

    let sessionsOut: Array<{
      store_name: string | null
      category: string | null
      time_minutes: number | null
      hostess_payout_amount: number
      status: string
      room_name: string | null
      receipt_status: string | null
    }> = []
    let totalCount = 0
    let totalPayout = 0
    let settlementFinalized = false

    if (businessDayId) {
      // 1. 본 매장 오늘 세션 — 식구가 본 매장 식구일 때 활동 조회용
      const { data: sessions } = await supabase
        .from("room_sessions")
        .select("id, room_uuid, status")
        .eq("store_uuid", auth.store_uuid)
        .eq("business_day_id", businessDayId)
      const sessionList = (sessions ?? []) as SessionRow[]
      const sessionIds = sessionList.map((s) => s.id)

      // 2. 이 식구의 본 매장 세션 참여
      let myStoreParts: ParticipationRow[] = []
      if (sessionIds.length > 0) {
        const { data: parts } = await supabase
          .from("session_participants")
          .select(
            "id, session_id, store_uuid, category, time_minutes, price_amount, hostess_payout_amount, status",
          )
          .eq("store_uuid", auth.store_uuid)
          .eq("membership_id", hostess_id)
          .in("session_id", sessionIds)
          .is("deleted_at", null)
        myStoreParts = (parts ?? []) as ParticipationRow[]
      }

      // 3. 타매장에 dispatch 간 참여 — origin_store 가 본 매장인 cross-store row
      const { data: crossParts } = await supabase
        .from("session_participants")
        .select(
          "id, session_id, store_uuid, category, time_minutes, price_amount, hostess_payout_amount, status",
        )
        .eq("origin_store_uuid", auth.store_uuid)
        .neq("store_uuid", auth.store_uuid)
        .eq("membership_id", hostess_id)
        .is("deleted_at", null)
      const crossList = (crossParts ?? []) as ParticipationRow[]

      const allParts = [...myStoreParts, ...crossList]

      // 4. 방 이름 + 매장 이름 + 영수증 상태
      const roomUuids = Array.from(new Set(sessionList.map((s) => s.room_uuid)))
      const roomMap = new Map<string, string>()
      if (roomUuids.length > 0) {
        const { data: rooms } = await supabase
          .from("rooms")
          .select("id, room_name")
          .in("id", roomUuids)
        for (const r of (rooms ?? []) as RoomRow[]) roomMap.set(r.id, r.room_name)
      }

      // 매장 이름 (cross-store working store names)
      // R-store-name-col (2026-06-26): 컬럼명 'name' → 'store_name' fix. 이전 select
      //   가 없는 컬럼이라 storeMap 항상 비어 매장명 "—" 표시되는 버그.
      const storeUuids = Array.from(new Set(allParts.map((p) => p.store_uuid)))
      const storeMap = new Map<string, string>()
      if (storeUuids.length > 0) {
        const { data: stores } = await supabase
          .from("stores")
          .select("id, store_name")
          .in("id", storeUuids)
        for (const s of (stores ?? []) as { id: string; store_name: string }[]) {
          storeMap.set(s.id, s.store_name)
        }
      }

      // 영수증 상태 (본 매장 세션만 가능 — cross-store 는 working store 의 receipt)
      const allSessionIds = Array.from(new Set(allParts.map((p) => p.session_id)))
      const receiptMap = new Map<string, string>()
      if (allSessionIds.length > 0) {
        const { data: receipts } = await supabase
          .from("receipts")
          .select("session_id, status, version")
          .in("session_id", allSessionIds)
          .order("version", { ascending: false })
        for (const r of (receipts ?? []) as ReceiptRow[]) {
          if (!receiptMap.has(r.session_id)) receiptMap.set(r.session_id, r.status)
        }
      }

      // 세션별 매핑
      const sessionMap = new Map<string, SessionRow>()
      for (const s of sessionList) sessionMap.set(s.id, s)

      sessionsOut = allParts.map((p) => {
        const ownSess = sessionMap.get(p.session_id)
        const roomName = ownSess ? roomMap.get(ownSess.room_uuid) ?? null : null
        const storeName = storeMap.get(p.store_uuid) ?? null
        return {
          store_name: storeName,
          category: p.category,
          time_minutes: p.time_minutes,
          hostess_payout_amount: Number(p.hostess_payout_amount ?? 0),
          status: p.status,
          room_name: roomName,
          receipt_status: receiptMap.get(p.session_id) ?? null,
        }
      })
      totalCount = sessionsOut.length
      totalPayout = sessionsOut.reduce((a, s) => a + s.hostess_payout_amount, 0)

      // 정산 완료 — 활동이 있고 전부 finalized 면 true
      if (totalCount > 0) {
        const allFinalized = sessionsOut.every(
          (s) => s.receipt_status === "finalized" || s.receipt_status === "confirmed",
        )
        settlementFinalized = allFinalized
      }
    }

    // 지급 정보 + 1타임당 실장수익 기본값
    const { data: membership } = await supabase
      .from("store_memberships")
      .select("payout_method, default_manager_deduction")
      .eq("id", hostess_id)
      .maybeSingle()
    const payoutMethod = (membership?.payout_method as "account" | "cash" | undefined) ?? "cash"
    const defaultDeduction = Number(membership?.default_manager_deduction ?? 0)

    const { data: bankRow } = await supabase
      .from("membership_bank_accounts")
      .select("bank_name, account_number, holder_name")
      .eq("membership_id", hostess_id)
      .eq("is_default", true)
      .is("deleted_at", null)
      .maybeSingle()

    return NextResponse.json({
      hostess_name: hostessName,
      today: {
        business_day_id: businessDayId,
        sessions: sessionsOut,
        total_count: totalCount,
        total_payout: totalPayout,
        settlement_finalized: settlementFinalized,
      },
      payout: {
        method: payoutMethod,
        bank_name: bankRow?.bank_name ?? null,
        account_number: bankRow?.account_number ?? null,
        holder_name: bankRow?.holder_name ?? null,
        default_manager_deduction: defaultDeduction,
      },
    })
  } catch (e) {
    if (e instanceof AuthError) {
      const status =
        e.type === "AUTH_MISSING" ? 401 :
        e.type === "AUTH_INVALID" ? 401 :
        e.type === "MEMBERSHIP_NOT_FOUND" ? 403 :
        e.type === "MEMBERSHIP_INVALID" ? 403 :
        e.type === "MEMBERSHIP_NOT_APPROVED" ? 403 : 500
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    console.error("[manager/hostess/info] GET error:", e)
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ hostess_id: string }> },
) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner" && auth.role !== "manager") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }
    const { hostess_id } = await params
    if (!hostess_id || !isValidUUID(hostess_id)) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "hostess_id (membership_id) 가 올바르지 않습니다." },
        { status: 400 },
      )
    }
    const supabase = getServiceClient()

    if (auth.role === "manager") {
      const ok = await assertManagerCanView(supabase, auth.store_uuid, auth.membership_id, hostess_id)
      if (!ok) {
        return NextResponse.json(
          { error: "NOT_ASSIGNED", message: "본인 담당 식구가 아닙니다." },
          { status: 403 },
        )
      }
    }

    const body = (await request.json().catch(() => ({}))) as {
      payout_method?: "account" | "cash"
      bank_name?: string | null
      account_number?: string | null
      holder_name?: string | null
      default_manager_deduction?: number | null
    }

    // 1. payout_method + default_manager_deduction 업데이트 (둘 다 store_memberships)
    const memUpdate: Record<string, unknown> = {}
    if (body.payout_method === "account" || body.payout_method === "cash") {
      memUpdate.payout_method = body.payout_method
    }
    if (typeof body.default_manager_deduction === "number") {
      const d = Math.max(0, Math.min(100000, Math.floor(body.default_manager_deduction)))
      memUpdate.default_manager_deduction = d
    }
    if (Object.keys(memUpdate).length > 0) {
      const { error: mErr } = await supabase
        .from("store_memberships")
        .update(memUpdate)
        .eq("id", hostess_id)
      if (mErr) {
        return NextResponse.json(
          { error: "DB_ERROR", message: `설정 저장 실패: ${mErr.message}` },
          { status: 500 },
        )
      }
    }

    // 2. 은행 정보 upsert — bank/account/holder 중 하나라도 있고 모두 채워졌으면
    const wantsBankUpdate =
      body.bank_name !== undefined ||
      body.account_number !== undefined ||
      body.holder_name !== undefined
    if (wantsBankUpdate) {
      const bn = (body.bank_name ?? "").trim()
      const an = (body.account_number ?? "").trim()
      const hn = (body.holder_name ?? "").trim()
      if (bn && an && hn) {
        // 기존 default row 조회 후 update 또는 insert
        const { data: existing } = await supabase
          .from("membership_bank_accounts")
          .select("id")
          .eq("membership_id", hostess_id)
          .eq("is_default", true)
          .is("deleted_at", null)
          .maybeSingle()
        if (existing?.id) {
          const { error: uErr } = await supabase
            .from("membership_bank_accounts")
            .update({
              bank_name: bn,
              account_number: an,
              holder_name: hn,
              updated_at: new Date().toISOString(),
            })
            .eq("id", existing.id)
          if (uErr) {
            return NextResponse.json(
              { error: "DB_ERROR", message: `계좌 저장 실패: ${uErr.message}` },
              { status: 500 },
            )
          }
        } else {
          const { error: iErr } = await supabase.from("membership_bank_accounts").insert({
            store_uuid: auth.store_uuid,
            membership_id: hostess_id,
            bank_name: bn,
            account_number: an,
            holder_name: hn,
            is_default: true,
            is_active: true,
          })
          if (iErr) {
            return NextResponse.json(
              { error: "DB_ERROR", message: `계좌 등록 실패: ${iErr.message}` },
              { status: 500 },
            )
          }
        }
      }
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    if (e instanceof AuthError) {
      const status =
        e.type === "AUTH_MISSING" ? 401 :
        e.type === "AUTH_INVALID" ? 401 :
        e.type === "MEMBERSHIP_NOT_FOUND" ? 403 :
        e.type === "MEMBERSHIP_INVALID" ? 403 :
        e.type === "MEMBERSHIP_NOT_APPROVED" ? 403 : 500
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    console.error("[manager/hostess/info] PATCH error:", e)
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
