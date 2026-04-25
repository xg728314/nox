import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { isValidUUID } from "@/lib/validation"

const CATEGORIES = ["settlement_mismatch", "ble_location", "ui_bug", "data_incorrect", "feature_request", "other"] as const
const SEVERITIES = ["critical", "high", "medium", "low"] as const
const STATUSES = ["open", "in_review", "resolved", "dismissed", "duplicate"] as const

/**
 * GET /api/issues?status=open,in_review&severity=critical,high
 *   owner/manager 만. 자기 매장 이슈 목록.
 *   manager 는 자기가 제출한 + assigned_to=self 만 볼 수 있음 (owner 는 전부).
 *
 * POST /api/issues
 *   누구나 (hostess 포함) 자기 매장에 이슈 제출.
 *   body: { category, severity, title, description?, related_*?, page_url?, user_agent? }
 */
export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner" && auth.role !== "manager") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "조회 권한이 없습니다." },
        { status: 403 },
      )
    }

    const url = new URL(request.url)
    const statusParam = url.searchParams.get("status")
    const severityParam = url.searchParams.get("severity")

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    let q = supabase
      .from("issue_reports")
      .select("id, store_uuid, reporter_profile_id, reporter_membership_id, reporter_role, category, severity, status, title, description, related_session_id, related_room_uuid, page_url, assigned_to, resolution_note, resolved_at, created_at, updated_at")
      .eq("store_uuid", auth.store_uuid)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(200)

    if (statusParam) {
      const statuses = statusParam.split(",").filter(s => STATUSES.includes(s as typeof STATUSES[number]))
      if (statuses.length > 0) q = q.in("status", statuses)
    }
    if (severityParam) {
      const severities = severityParam.split(",").filter(s => SEVERITIES.includes(s as typeof SEVERITIES[number]))
      if (severities.length > 0) q = q.in("severity", severities)
    }

    // manager 는 자기가 제출한 것만
    if (auth.role === "manager") {
      q = q.eq("reporter_membership_id", auth.membership_id)
    }

    const { data, error } = await q
    if (error) {
      console.error("[issues GET] query failed:", error)
      return NextResponse.json(
        { error: "QUERY_FAILED" },
        { status: 500 },
      )
    }

    // 제출자 이름 lookup
    const reporterIds = [...new Set(
      (data ?? []).map(r => r.reporter_profile_id).filter(Boolean) as string[],
    )]
    const { data: profiles } = reporterIds.length > 0
      ? await supabase.from("profiles").select("id, name").in("id", reporterIds)
      : { data: [] as Array<{ id: string; name: string }> }
    const nameMap = new Map((profiles ?? []).map(p => [p.id, p.name]))

    const enriched = (data ?? []).map(r => ({
      ...r,
      reporter_name: r.reporter_profile_id ? nameMap.get(r.reporter_profile_id) ?? null : null,
    }))

    return NextResponse.json({ issues: enriched, total: enriched.length })
  } catch (error) {
    if (error instanceof AuthError) {
      const status =
        error.type === "AUTH_MISSING" || error.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    // 모든 role 제출 가능

    let body: Record<string, unknown>
    try {
      body = (await request.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    }

    const title = typeof body.title === "string" ? body.title.trim() : ""
    if (!title) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "제목은 필수입니다." },
        { status: 400 },
      )
    }
    if (title.length > 200) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "제목은 200자 이내입니다." },
        { status: 400 },
      )
    }

    const category = typeof body.category === "string" && CATEGORIES.includes(body.category as typeof CATEGORIES[number])
      ? body.category
      : "other"
    const severity = typeof body.severity === "string" && SEVERITIES.includes(body.severity as typeof SEVERITIES[number])
      ? body.severity
      : "medium"

    const description = typeof body.description === "string" ? body.description.slice(0, 5000) : null
    const pageUrl = typeof body.page_url === "string" ? body.page_url.slice(0, 500) : null
    const userAgent = typeof body.user_agent === "string" ? body.user_agent.slice(0, 500) : null

    const relatedSessionId = typeof body.related_session_id === "string" && isValidUUID(body.related_session_id)
      ? body.related_session_id : null
    const relatedRoomUuid = typeof body.related_room_uuid === "string" && isValidUUID(body.related_room_uuid)
      ? body.related_room_uuid : null
    const relatedParticipantId = typeof body.related_participant_id === "string" && isValidUUID(body.related_participant_id)
      ? body.related_participant_id : null
    const relatedReceiptId = typeof body.related_receipt_id === "string" && isValidUUID(body.related_receipt_id)
      ? body.related_receipt_id : null

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { data: inserted, error: insertErr } = await supabase
      .from("issue_reports")
      .insert({
        store_uuid: auth.store_uuid,
        reporter_profile_id: auth.user_id,
        reporter_membership_id: auth.membership_id,
        reporter_role: auth.role,
        category,
        severity,
        status: "open",
        title,
        description,
        related_session_id: relatedSessionId,
        related_room_uuid: relatedRoomUuid,
        related_participant_id: relatedParticipantId,
        related_receipt_id: relatedReceiptId,
        page_url: pageUrl,
        user_agent: userAgent,
      })
      .select("id, title, severity, status, created_at")
      .single()

    if (insertErr || !inserted) {
      console.error("[issues POST] insert failed:", insertErr)
      return NextResponse.json(
        { error: "INSERT_FAILED", message: "제출 실패" },
        { status: 500 },
      )
    }

    return NextResponse.json(inserted, { status: 201 })
  } catch (error) {
    if (error instanceof AuthError) {
      const status =
        error.type === "AUTH_MISSING" || error.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
