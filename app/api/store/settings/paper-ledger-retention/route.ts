import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { logAuditEvent } from "@/lib/audit/logEvent"

/**
 * GET / PUT /api/store/settings/paper-ledger-retention
 *
 * R-Paper-Retention (2026-05-01): 매장별 종이장부 사진 자동 만료 일수.
 *
 * 정책:
 *   - 0 또는 null = 자동 만료 안 함 (수동 삭제만)
 *   - 1~365 = 해당 일수 후 cron 이 자동 cascade 삭제
 *   - default 30
 *   - 영업일 잠금 X (정산 무관 설정)
 *
 * 권한:
 *   - 조회: owner / manager / waiter (운영자 영역)
 *   - 변경: owner 또는 super_admin 만 (정보보호 정책 결정 = 매장 책임자)
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key)
}

const DEFAULT_DAYS = 30
const MAX_DAYS = 365

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    const supabase = supa()
    const { data } = await supabase
      .from("store_settings")
      .select("paper_ledger_retention_days, updated_at")
      .eq("store_uuid", auth.store_uuid)
      .maybeSingle()

    const days = (data as { paper_ledger_retention_days?: number } | null)
      ?.paper_ledger_retention_days
    return NextResponse.json({
      paper_ledger_retention_days: typeof days === "number" ? days : DEFAULT_DAYS,
      updated_at: (data as { updated_at?: string } | null)?.updated_at ?? null,
      defaults: { days: DEFAULT_DAYS, max: MAX_DAYS },
      policy: {
        zero_means: "자동 만료 없음 (수동 삭제만)",
        cascade: "사진 + extractions + edits + diffs 삭제 / learning_signals 보존",
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
    if (auth.role !== "owner" && !auth.is_super_admin) {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "보관 기간 설정은 사장 또는 운영자만 가능합니다." },
        { status: 403 },
      )
    }

    const body = (await request.json().catch(() => ({}))) as {
      paper_ledger_retention_days?: number
    }
    const raw = body.paper_ledger_retention_days
    if (typeof raw !== "number" || !Number.isInteger(raw)) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "paper_ledger_retention_days must be integer" },
        { status: 400 },
      )
    }
    if (raw < 0 || raw > MAX_DAYS) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: `0~${MAX_DAYS} 범위. 0 = 자동 만료 없음.` },
        { status: 400 },
      )
    }

    const supabase = supa()

    // store_settings row 가 없을 수 있음 — upsert.
    const { data: existing } = await supabase
      .from("store_settings")
      .select("id")
      .eq("store_uuid", auth.store_uuid)
      .maybeSingle()

    if (!existing) {
      const { error: insErr } = await supabase
        .from("store_settings")
        .insert({
          store_uuid: auth.store_uuid,
          paper_ledger_retention_days: raw,
        })
      if (insErr) {
        return NextResponse.json({ error: "INSERT_FAILED", message: insErr.message }, { status: 500 })
      }
    } else {
      const { error: upErr } = await supabase
        .from("store_settings")
        .update({
          paper_ledger_retention_days: raw,
          updated_at: new Date().toISOString(),
        })
        .eq("store_uuid", auth.store_uuid)
      if (upErr) {
        return NextResponse.json({ error: "UPDATE_FAILED", message: upErr.message }, { status: 500 })
      }
    }

    try {
      await logAuditEvent(supabase, {
        auth,
        action: "paper_ledger_retention_changed",
        entity_table: "store_settings",
        entity_id: auth.store_uuid,
        metadata: {
          new_days: raw,
          interpretation: raw === 0 ? "자동 만료 없음" : `${raw}일 후 자동 삭제`,
        },
      })
    } catch { /* audit best-effort */ }

    return NextResponse.json({
      ok: true,
      paper_ledger_retention_days: raw,
    })
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
