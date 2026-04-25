import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { logAuditEvent } from "@/lib/audit/logEvent"

/**
 * POST /api/payouts/settlement-tree/confirm
 *
 * R29: "정산 완료 처리" 버튼. 현재 트리에 노출된 모든 active 정산 row 의
 *   confirmed_at = now() 로 마킹. 48시간 뒤 자동 리셋.
 *
 * 권한: owner / manager.
 * 매장 스코프: auth.store_uuid 의 cross_store_settlements 만.
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key)
}

export async function POST(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner" && auth.role !== "manager") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }

    const supabase = supa()
    const nowIso = new Date().toISOString()

    // 현재 매장의 active 정산 (confirmed_at IS NULL) 만 마킹.
    //   이미 완료된 row 는 그대로 두고 (시간 갱신 안 함).
    const { data: settlements, error: sErr } = await supabase
      .from("cross_store_settlements")
      .update({ confirmed_at: nowIso })
      .eq("store_uuid", auth.store_uuid)
      .is("deleted_at", null)
      .is("confirmed_at", null)
      .select("id")
    const sCount = settlements?.length ?? 0

    if (sErr) {
      return NextResponse.json(
        { error: "DB_UPDATE_FAILED", message: sErr.message },
        { status: 500 },
      )
    }

    // items 도 같이 — header 와 동기.
    const settlementIds = (settlements ?? []).map(r => r.id as string)
    let itemCount = 0
    if (settlementIds.length > 0) {
      const { data: items, error: iErr } = await supabase
        .from("cross_store_settlement_items")
        .update({ confirmed_at: nowIso })
        .in("cross_store_settlement_id", settlementIds)
        .is("deleted_at", null)
        .is("confirmed_at", null)
        .select("id")
      if (iErr) {
        console.warn("[settlement-tree confirm] items update warn:", iErr.message)
      }
      itemCount = items?.length ?? 0
    }

    await logAuditEvent(supabase, {
      auth,
      action: "settlement_tree_confirmed",
      entity_table: "cross_store_settlements",
      entity_id: auth.store_uuid,
      status: "success",
      metadata: {
        confirmed_at: nowIso,
        settlement_count: sCount ?? 0,
        item_count: itemCount,
      },
    })

    return NextResponse.json({
      ok: true,
      confirmed_at: nowIso,
      settlement_count: sCount ?? 0,
      item_count: itemCount,
      reset_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    })
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
