import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { logAuditEvent } from "@/lib/audit/logEvent"
import { resolveFeatureAccess, RECONCILE_ROLE_DEFAULTS } from "@/lib/auth/featureAccess"
import type { PaperExtraction, SheetKind } from "@/lib/reconcile/types"

/**
 * POST /api/reconcile/[id]/edit
 *
 * R-B: 사람이 검수+수정한 추출 결과를 paper_ledger_edits 에 새 row 로 저장.
 *
 * body:
 *   {
 *     edited_json: PaperExtraction,
 *     base_extraction_id?: uuid,   // 누락 시 최신 extraction 자동
 *     edit_reason?: string,
 *   }
 *
 * 권한: business_date 별 'edit' action (R-Auth helper).
 *
 * 효과:
 *   - paper_ledger_edits insert (이력 보관 — 다중 편집 가능)
 *   - paper_ledger_snapshots.status = 'edited'
 *   - audit_events insert
 *
 * 금지:
 *   - NOX 운영 데이터 (room_sessions/orders/...) write 0건
 *     (R-C 의 /apply 가 그 역할)
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key)
}

/** 가벼운 schema sanity check — schema_version 1 + sheet_kind 매칭만 */
function validateEditedJson(v: unknown, expectedSheetKind: SheetKind): { ok: true; value: PaperExtraction } | { ok: false; error: string } {
  if (!v || typeof v !== "object") return { ok: false, error: "edited_json 은 object 여야 합니다." }
  const o = v as Record<string, unknown>
  if (o.schema_version !== 1) return { ok: false, error: `schema_version=1 필요 (got ${String(o.schema_version)})` }
  if (o.sheet_kind !== expectedSheetKind) return { ok: false, error: `sheet_kind 가 snapshot 과 다릅니다 (expected ${expectedSheetKind}, got ${String(o.sheet_kind)})` }
  if (!Array.isArray(o.unknown_tokens)) o.unknown_tokens = []
  return { ok: true, value: v as PaperExtraction }
}

/** edit_summary 메타 자동 계산 — UI 표시 + audit. base 없으면 빈 메타. */
function computeEditSummary(base: PaperExtraction | null, edited: PaperExtraction): Record<string, number> {
  if (!base) return {}
  const baseRoomCount = Array.isArray(base.rooms) ? base.rooms.length : 0
  const editedRoomCount = Array.isArray(edited.rooms) ? edited.rooms.length : 0
  const baseStaffCount = Array.isArray(base.rooms)
    ? base.rooms.reduce((acc, r) => acc + (r.staff_entries?.length ?? 0), 0)
    : 0
  const editedStaffCount = Array.isArray(edited.rooms)
    ? edited.rooms.reduce((acc, r) => acc + (r.staff_entries?.length ?? 0), 0)
    : 0
  return {
    rooms_before: baseRoomCount,
    rooms_after: editedRoomCount,
    staff_entries_before: baseStaffCount,
    staff_entries_after: editedStaffCount,
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params
    if (!/^[0-9a-f-]{36}$/.test(id)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "id 는 UUID." }, { status: 400 })
    }

    const auth = await resolveAuthContext(request)

    const body = (await request.json().catch(() => ({}))) as {
      edited_json?: unknown
      base_extraction_id?: unknown
      edit_reason?: unknown
    }
    const editReason = typeof body.edit_reason === "string" ? body.edit_reason.trim() || null : null

    const supabase = supa()

    // 1. snapshot 조회 + 매장 스코프
    const { data: snap } = await supabase
      .from("paper_ledger_snapshots")
      .select("id, store_uuid, business_date, sheet_kind, status")
      .eq("id", id)
      .is("archived_at", null)
      .maybeSingle()
    if (!snap) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
    }
    const s = snap as {
      id: string; store_uuid: string; business_date: string;
      sheet_kind: SheetKind; status: string
    }
    if (s.store_uuid !== auth.store_uuid) {
      return NextResponse.json({ error: "STORE_FORBIDDEN" }, { status: 403 })
    }

    // 2. status 게이트 — uploaded / extracting / extract_failed 는 거부
    const ALLOWED_STATUS = new Set(["extracted", "edited", "reviewed"])
    if (!ALLOWED_STATUS.has(s.status)) {
      return NextResponse.json(
        { error: "INVALID_STATUS", message: `status=${s.status} 에서는 편집 불가. 먼저 추출(extract) 을 완료하세요.` },
        { status: 409 },
      )
    }

    // 3. R-Auth: edit 권한 검증
    const access = await resolveFeatureAccess(supabase, auth, {
      table: "paper_ledger_access_grants",
      store_uuid: s.store_uuid,
      business_date: s.business_date,
      action: "edit",
      role_defaults: RECONCILE_ROLE_DEFAULTS,
    })
    if (!access.allowed) {
      return NextResponse.json(
        { error: "ACCESS_DENIED", message: "이 날짜의 종이장부 편집 권한이 없습니다.", via: access.via },
        { status: 403 },
      )
    }

    // 4. edited_json 검증
    const validated = validateEditedJson(body.edited_json, s.sheet_kind)
    if (!validated.ok) {
      return NextResponse.json({ error: "BAD_REQUEST", message: validated.error }, { status: 400 })
    }
    const editedJson = validated.value

    // 5. base_extraction_id 결정 (누락 시 최신 extraction 자동)
    let baseExtractionId: string | null = null
    let baseJson: PaperExtraction | null = null
    if (typeof body.base_extraction_id === "string" && /^[0-9a-f-]{36}$/.test(body.base_extraction_id)) {
      const { data: baseRow } = await supabase
        .from("paper_ledger_extractions")
        .select("id, snapshot_id, extracted_json")
        .eq("id", body.base_extraction_id)
        .maybeSingle()
      if (!baseRow || (baseRow as { snapshot_id: string }).snapshot_id !== id) {
        return NextResponse.json({ error: "BAD_REQUEST", message: "base_extraction_id 가 이 snapshot 의 추출이 아닙니다." }, { status: 400 })
      }
      baseExtractionId = (baseRow as { id: string }).id
      baseJson = (baseRow as { extracted_json: PaperExtraction }).extracted_json
    } else {
      const { data: latest } = await supabase
        .from("paper_ledger_extractions")
        .select("id, extracted_json")
        .eq("snapshot_id", id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
      if (latest) {
        baseExtractionId = (latest as { id: string }).id
        baseJson = (latest as { extracted_json: PaperExtraction }).extracted_json
      }
    }

    // 6. edit_summary 계산
    const editSummary = computeEditSummary(baseJson, editedJson)

    // 7. insert
    const { data: edit, error: insErr } = await supabase
      .from("paper_ledger_edits")
      .insert({
        snapshot_id: id,
        base_extraction_id: baseExtractionId,
        edited_json: editedJson,
        edit_summary: editSummary,
        edit_reason: editReason,
        edited_by: auth.user_id,
      })
      .select("id, edited_at")
      .single()
    if (insErr) {
      return NextResponse.json({ error: "DB_INSERT_FAILED", message: insErr.message }, { status: 500 })
    }
    const e = edit as { id: string; edited_at: string }

    // 8. snapshot status = 'edited'
    await supabase
      .from("paper_ledger_snapshots")
      .update({ status: "edited", updated_at: new Date().toISOString() })
      .eq("id", id)

    // 9. audit
    await logAuditEvent(supabase, {
      auth,
      action: "paper_ledger_edited",
      entity_table: "paper_ledger_edits",
      entity_id: e.id,
      status: "success",
      metadata: {
        snapshot_id: id,
        base_extraction_id: baseExtractionId,
        summary: editSummary,
        applied_grants: access.applied_grants,
      },
      reason: editReason,
    })

    return NextResponse.json({
      edit_id: e.id,
      edited_at: e.edited_at,
      summary: editSummary,
    })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
