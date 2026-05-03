import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"

/**
 * /api/staff-board
 *
 * R-Staff-Board (2026-05-01): 매장간 스태프 요청·가용 보드.
 *
 * GET    — 활성 카드 list (전체 매장 + 본인 매장 강조)
 * POST   — 본인 매장 카드 등록 또는 갱신 (upsert by store + kind)
 *
 * 권한:
 *   GET   : 인증 필요. 모든 role (스태프 hostess/staff 포함) 조회 가능.
 *   POST  : owner / manager / waiter (운영자 영역).
 *           hostess / staff 는 차단.
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const POSTABLE_ROLES = ["owner", "manager", "waiter"] as const
const DEFAULT_TTL_MIN = 15

function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key)
}

type BoardRow = {
  id: string
  store_uuid: string
  request_kind: "need" | "available"
  service_types: string[]
  party_size: number
  tags: string[]
  memo: string | null
  posted_at: string
  expires_at: string
  status: string
  update_count: number
}

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    const supabase = supa()
    const url = new URL(request.url)
    const kind = url.searchParams.get("kind") as "need" | "available" | null

    let q = supabase
      .from("staff_request_board")
      .select(
        "id, store_uuid, request_kind, service_types, party_size, tags, memo, posted_at, expires_at, status, update_count",
      )
      .eq("status", "active")
      .gt("expires_at", new Date().toISOString())
      .order("posted_at", { ascending: false })
      .limit(100)
    if (kind) q = q.eq("request_kind", kind)

    const { data, error } = await q
    if (error) {
      return NextResponse.json({ error: "DB_ERROR", message: error.message }, { status: 500 })
    }
    const rows = (data ?? []) as BoardRow[]

    // 2026-05-03 R-Speed-x10: stores + responses 직렬 → Promise.all 병렬.
    //   둘 다 rows 결과만 의존 (서로 무관). 직렬 ~2 RTT → 1 RTT.
    const storeIds = Array.from(new Set(rows.map((r) => r.store_uuid)))
    const [storesRes, respRowsRes] = await Promise.all([
      storeIds.length > 0
        ? supabase
            .from("stores")
            .select("id, store_name, floor_no")
            .in("id", storeIds)
        : Promise.resolve({ data: [] as Array<{ id: string; store_name: string; floor_no: number | null }> }),
      rows.length > 0
        ? supabase
            .from("staff_request_responses")
            .select("request_id")
            .in("request_id", rows.map((r) => r.id))
        : Promise.resolve({ data: [] as Array<{ request_id: string }> }),
    ])

    const storeNameMap = new Map<string, string>()
    for (const s of (storesRes.data ?? []) as Array<{ id: string; store_name: string; floor_no: number | null }>) {
      storeNameMap.set(s.id, `${s.floor_no ? `${s.floor_no}층 ` : ""}${s.store_name}`)
    }

    const responseCount = new Map<string, number>()
    for (const r of (respRowsRes.data ?? []) as Array<{ request_id: string }>) {
      responseCount.set(r.request_id, (responseCount.get(r.request_id) ?? 0) + 1)
    }

    return NextResponse.json({
      items: rows.map((r) => ({
        ...r,
        store_label: storeNameMap.get(r.store_uuid) ?? r.store_uuid.slice(0, 8),
        is_mine: r.store_uuid === auth.store_uuid,
        response_count: responseCount.get(r.id) ?? 0,
      })),
      my_store_uuid: auth.store_uuid,
      generated_at: new Date().toISOString(),
    })
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (!(POSTABLE_ROLES as readonly string[]).includes(auth.role)) {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "owner / manager / waiter 만 보드에 등록할 수 있습니다." },
        { status: 403 },
      )
    }

    const body = (await request.json().catch(() => ({}))) as {
      request_kind?: string
      service_types?: string[]
      party_size?: number
      tags?: string[]
      memo?: string | null
      ttl_minutes?: number
    }

    const kind = body.request_kind
    if (kind !== "need" && kind !== "available") {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "request_kind must be 'need' or 'available'" },
        { status: 400 },
      )
    }
    const partySize = Number(body.party_size)
    if (!Number.isInteger(partySize) || partySize < 1 || partySize > 20) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "party_size must be 1~20" },
        { status: 400 },
      )
    }
    const serviceTypes = Array.isArray(body.service_types)
      ? body.service_types.filter((s): s is string => typeof s === "string").slice(0, 5)
      : []
    const tags = Array.isArray(body.tags)
      ? body.tags.filter((t): t is string => typeof t === "string").slice(0, 10)
      : []
    const memo = typeof body.memo === "string" ? body.memo.slice(0, 200) : null
    const ttlMin = Math.min(Math.max(body.ttl_minutes ?? DEFAULT_TTL_MIN, 1), 60)
    const expiresAt = new Date(Date.now() + ttlMin * 60_000).toISOString()

    const supabase = supa()

    // 본인 매장 같은 kind active row 가 있는지 — upsert 패턴
    const { data: existing } = await supabase
      .from("staff_request_board")
      .select("id, update_count")
      .eq("store_uuid", auth.store_uuid)
      .eq("request_kind", kind)
      .eq("status", "active")
      .maybeSingle()

    if (existing) {
      const exRow = existing as { id: string; update_count: number }
      const { data: updated, error: upErr } = await supabase
        .from("staff_request_board")
        .update({
          service_types: serviceTypes,
          party_size: partySize,
          tags,
          memo,
          expires_at: expiresAt,
          posted_at: new Date().toISOString(),
          update_count: (exRow.update_count ?? 0) + 1,
        })
        .eq("id", exRow.id)
        .select()
        .maybeSingle()
      if (upErr) {
        return NextResponse.json({ error: "UPDATE_FAILED", message: upErr.message }, { status: 500 })
      }
      return NextResponse.json({ item: updated, action: "updated" })
    }

    const { data: inserted, error: insErr } = await supabase
      .from("staff_request_board")
      .insert({
        store_uuid: auth.store_uuid,
        request_kind: kind,
        service_types: serviceTypes,
        party_size: partySize,
        tags,
        memo,
        posted_by_user_id: auth.user_id,
        posted_by_membership_id: auth.membership_id,
        expires_at: expiresAt,
      })
      .select()
      .maybeSingle()
    if (insErr) {
      return NextResponse.json({ error: "INSERT_FAILED", message: insErr.message }, { status: 500 })
    }
    return NextResponse.json({ item: inserted, action: "created" })
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
