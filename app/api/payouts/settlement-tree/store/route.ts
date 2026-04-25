import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { logAuditEvent } from "@/lib/audit/logEvent"
import { isValidUUID } from "@/lib/validation"

/**
 * DELETE /api/payouts/settlement-tree/store?counterpart_store_uuid=...
 *
 * R29 (정정): 사용자(실장)별 매장 숨김.
 *   - 글로벌 soft delete 가 아님 — 본인 시점에서만 안 보이게 한다.
 *   - 같은 매장의 다른 실장은 영향 받지 않음.
 *   - Stage 1 → 2 → 3 자동 진행은 그대로 (cron 이 처리).
 *   - Stage 3 만료 시 cron 이 cross_store_settlements.deleted_at 마킹 → 글로벌 삭제.
 *
 * 이 엔드포인트는 settlement_tree_user_hides 테이블에 (user_id, store_uuid,
 *   counterpart_store_uuid) 한 행 upsert 만 한다.
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

export async function DELETE(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner" && auth.role !== "manager") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }

    const url = new URL(request.url)
    const counterpart = url.searchParams.get("counterpart_store_uuid")
    if (!counterpart || !isValidUUID(counterpart)) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "counterpart_store_uuid (uuid) required." },
        { status: 400 },
      )
    }

    const supabase = supa()

    // Upsert hide row. ON CONFLICT 로 hidden_at 갱신.
    const { error } = await supabase
      .from("settlement_tree_user_hides")
      .upsert(
        {
          user_id: auth.user_id,
          store_uuid: auth.store_uuid,
          counterpart_store_uuid: counterpart,
          hidden_at: new Date().toISOString(),
        },
        { onConflict: "user_id,store_uuid,counterpart_store_uuid" },
      )

    if (error) {
      // migration 098 미적용이면 42P01 (relation does not exist).
      if (error.code === "42P01") {
        return NextResponse.json(
          {
            error: "MIGRATION_PENDING",
            message: "settlement_tree_user_hides 테이블 미생성. database/098 migration 적용 필요.",
            detail: error.message,
          },
          { status: 503 },
        )
      }
      console.error("[tree/store DELETE] upsert error:", JSON.stringify(error))
      return NextResponse.json(
        { error: "DB_UPDATE_FAILED", message: error.message },
        { status: 500 },
      )
    }

    await logAuditEvent(supabase, {
      auth,
      action: "settlement_tree_store_hidden_user",
      entity_table: "cross_store_settlements",
      entity_id: counterpart,
      status: "success",
      metadata: {
        scope: "user",
        counterpart_store_uuid: counterpart,
      },
    })

    return NextResponse.json({ ok: true, scope: "user" })
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}

/**
 * POST /api/payouts/settlement-tree/store?action=unhide&counterpart_store_uuid=...
 *
 * 숨김 해제 — 다시 트리에 노출.
 */
export async function POST(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner" && auth.role !== "manager") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }
    const url = new URL(request.url)
    const counterpart = url.searchParams.get("counterpart_store_uuid")
    if (!counterpart || !isValidUUID(counterpart)) {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    }
    if (url.searchParams.get("action") !== "unhide") {
      return NextResponse.json({ error: "BAD_REQUEST", message: "action=unhide required." }, { status: 400 })
    }

    const supabase = supa()
    const { error } = await supabase
      .from("settlement_tree_user_hides")
      .delete()
      .eq("user_id", auth.user_id)
      .eq("store_uuid", auth.store_uuid)
      .eq("counterpart_store_uuid", counterpart)

    if (error && error.code !== "42P01") {
      return NextResponse.json({ error: "DB_DELETE_FAILED", message: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
