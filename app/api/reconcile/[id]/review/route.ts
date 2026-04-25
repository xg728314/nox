import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { logAuditEvent } from "@/lib/audit/logEvent"

/**
 * POST /api/reconcile/[id]/review
 *
 * R30: 사람이 사진 + diff 결과를 보고 최종 확정.
 *
 * body:
 *   { decision: 'confirm' | 'reject' | 'note_only',
 *     notes?: string,
 *     manual_overrides?: { /* 자유 jsonb — 추후 라운드 *\/ } }
 *
 * 효과:
 *   - decision='confirm':
 *       snapshot.status='reviewed', reviewed_by=auth.user, reviewed_at=now.
 *       diff 가 있으면 reviewer_notes 기록.
 *       이걸 거치면 "그날 NOX 가 종이장부와 일치한다" 사람 확정.
 *   - decision='reject':
 *       status는 그대로, diff.match_status는 'mismatch' 로 강제 + notes.
 *
 * 권한: owner / manager.
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key)
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params
    if (!/^[0-9a-f-]{36}$/.test(id)) {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    }
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner" && auth.role !== "manager") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }

    const body = (await request.json().catch(() => ({}))) as {
      decision?: "confirm" | "reject" | "note_only"
      notes?: string
      manual_overrides?: Record<string, unknown>
    }
    if (!body.decision || !["confirm", "reject", "note_only"].includes(body.decision)) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "decision 은 confirm/reject/note_only." },
        { status: 400 },
      )
    }

    const supabase = supa()
    const { data: snap } = await supabase
      .from("paper_ledger_snapshots")
      .select("id, store_uuid, status")
      .eq("id", id)
      .is("archived_at", null)
      .maybeSingle()
    if (!snap) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
    }
    const s = snap as { id: string; store_uuid: string; status: string }
    if (s.store_uuid !== auth.store_uuid) {
      return NextResponse.json({ error: "STORE_FORBIDDEN" }, { status: 403 })
    }

    const nowIso = new Date().toISOString()

    if (body.decision === "confirm") {
      await supabase
        .from("paper_ledger_snapshots")
        .update({
          status: "reviewed",
          reviewed_by: auth.user_id,
          reviewed_at: nowIso,
          notes: body.notes ?? null,
          updated_at: nowIso,
        })
        .eq("id", id)
    } else if (body.decision === "note_only") {
      await supabase
        .from("paper_ledger_snapshots")
        .update({
          notes: body.notes ?? null,
          updated_at: nowIso,
        })
        .eq("id", id)
    }
    // reject: snapshot 자체는 그대로 (재추출/재검토 가능). diff 만 메모 갱신.

    if (body.decision === "reject" || body.decision === "confirm" || body.decision === "note_only") {
      const { data: latestDiff } = await supabase
        .from("paper_ledger_diffs")
        .select("id")
        .eq("snapshot_id", id)
        .order("computed_at", { ascending: false })
        .limit(1)
        .maybeSingle()
      if (latestDiff) {
        const updates: Record<string, unknown> = {
          reviewer_notes: body.notes ?? null,
        }
        if (body.manual_overrides) {
          updates.manual_overrides = body.manual_overrides
        }
        if (body.decision === "reject") {
          updates.match_status = "mismatch"
        }
        await supabase
          .from("paper_ledger_diffs")
          .update(updates)
          .eq("id", (latestDiff as { id: string }).id)
      }
    }

    await logAuditEvent(supabase, {
      auth,
      action: `paper_ledger_review_${body.decision}`,
      entity_table: "paper_ledger_snapshots",
      entity_id: id,
      status: "success",
      metadata: { has_notes: !!body.notes, has_overrides: !!body.manual_overrides },
    })

    return NextResponse.json({ ok: true })
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
