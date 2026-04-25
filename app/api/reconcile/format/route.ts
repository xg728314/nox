import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { logAuditEvent } from "@/lib/audit/logEvent"
import { DEFAULT_KNOWN_STORES, DEFAULT_SYMBOL_DICTIONARY } from "@/lib/reconcile/symbols"

/**
 * GET  /api/reconcile/format     — 우리 매장 종이 포맷 조회 (없으면 default)
 * PUT  /api/reconcile/format     — symbol_dictionary / known_stores 갱신
 *
 * R30: 매장별 종이장부 포맷 학습. owner 만 수정 가능 (도메인 규칙 변경 권한).
 *      manager 는 read.
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key)
}

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner" && auth.role !== "manager") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }
    const supabase = supa()
    const { data } = await supabase
      .from("store_paper_format")
      .select("store_uuid, format_version, symbol_dictionary, known_stores, notes, updated_by, updated_at")
      .eq("store_uuid", auth.store_uuid)
      .maybeSingle()

    return NextResponse.json({
      store_uuid: auth.store_uuid,
      format: data ?? null,
      defaults: {
        symbol_dictionary: DEFAULT_SYMBOL_DICTIONARY,
        known_stores: DEFAULT_KNOWN_STORES,
      },
    })
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "owner 만 종이 포맷을 수정할 수 있습니다." },
        { status: 403 },
      )
    }

    const body = (await request.json().catch(() => ({}))) as {
      symbol_dictionary?: Record<string, unknown>
      known_stores?: string[]
      notes?: string
    }

    const update: Record<string, unknown> = {
      updated_by: auth.user_id,
      updated_at: new Date().toISOString(),
    }
    if (body.symbol_dictionary && typeof body.symbol_dictionary === "object") {
      update.symbol_dictionary = body.symbol_dictionary
    }
    if (Array.isArray(body.known_stores)) {
      update.known_stores = body.known_stores
        .filter(s => typeof s === "string" && s.trim().length > 0)
        .map(s => s.trim())
        .slice(0, 100)
    }
    if (typeof body.notes === "string") {
      update.notes = body.notes.slice(0, 1000)
    }

    const supabase = supa()
    const { data: existing } = await supabase
      .from("store_paper_format")
      .select("store_uuid")
      .eq("store_uuid", auth.store_uuid)
      .maybeSingle()

    if (existing) {
      const { error } = await supabase
        .from("store_paper_format")
        .update(update)
        .eq("store_uuid", auth.store_uuid)
      if (error) {
        return NextResponse.json({ error: "DB_UPDATE_FAILED", message: error.message }, { status: 500 })
      }
    } else {
      const { error } = await supabase
        .from("store_paper_format")
        .insert({
          store_uuid: auth.store_uuid,
          format_version: 1,
          symbol_dictionary: update.symbol_dictionary ?? {},
          known_stores: update.known_stores ?? [],
          notes: update.notes ?? null,
          updated_by: auth.user_id,
        })
      if (error) {
        return NextResponse.json({ error: "DB_INSERT_FAILED", message: error.message }, { status: 500 })
      }
    }

    await logAuditEvent(supabase, {
      auth,
      action: "paper_format_updated",
      entity_table: "paper_ledger_snapshots",  // closest reuse
      entity_id: auth.store_uuid,
      status: "success",
      metadata: {
        symbol_count: update.symbol_dictionary
          ? Object.keys(update.symbol_dictionary as Record<string, unknown>).length
          : null,
        known_stores_count: update.known_stores
          ? (update.known_stores as string[]).length
          : null,
      },
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
