import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"

/**
 * GET /api/learn/export
 *
 * R-Learn-Corpus (2026-04-30): learning_signals corpus 추출 엔드포인트.
 *
 * 운영자 의도:
 *   "사람이 수정한 raw → corrected 쌍을 누적했다. 이걸 꺼내서 외부
 *    모델 fine-tune 또는 패턴 분석에 쓴다."
 *
 * 가드:
 *   - super_admin only (시스템 차원의 학습 데이터 관리는 cross-store 영역).
 *   - owner / manager / hostess 는 거부 — 본인 매장 데이터라도 학습
 *     corpus 는 운영용이 아님.
 *
 * Query:
 *   - target_store_uuid: 특정 매장만 (생략 시 전 매장)
 *   - signal_type:       정확 일치
 *   - signal_type_prefix: prefix LIKE (ex. "reconcile.staff.")
 *   - since:             ISO datetime, created_at >= since
 *   - format:            "csv" | "json" (default json)
 *   - limit:             default 1000, max 5000
 *   - include_pii:       "true" 면 pii_masked=true row 도 포함 (hash 형태로)
 *
 * 응답:
 *   - format=json → { rows: [...], count: N, limited: bool }
 *   - format=csv  → text/csv (BOM 포함, Excel KR 호환)
 *
 * PII:
 *   - raw_value / corrected_value 는 이미 captureSignal helper 가
 *     hash 처리한 상태로 저장되어 있음. 본 API 는 raw 텍스트 복원 시도 X.
 *   - pii_masked=true row 는 default 로 제외 (include_pii=true 명시 시 포함).
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key)
}

function csvEscape(v: unknown): string {
  if (v == null) return ""
  const s = String(v)
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (!auth.is_super_admin) {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Super admin access required." },
        { status: 403 },
      )
    }

    const url = new URL(request.url)
    const targetStore = url.searchParams.get("target_store_uuid")
    const signalType = url.searchParams.get("signal_type")
    const signalTypePrefix = url.searchParams.get("signal_type_prefix")
    const since = url.searchParams.get("since")
    const format = (url.searchParams.get("format") ?? "json").toLowerCase()
    const includePii = url.searchParams.get("include_pii") === "true"
    const limitParam = parseInt(url.searchParams.get("limit") ?? "1000", 10)
    const limit = Math.min(Math.max(isFinite(limitParam) ? limitParam : 1000, 1), 5000)

    const supabase = supa()

    let q = supabase
      .from("learning_signals")
      .select(
        "id, store_uuid, signal_type, raw_value, corrected_value, pii_masked, source_model, source_prompt_version, created_at",
      )
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(limit)

    if (targetStore) q = q.eq("store_uuid", targetStore)
    if (signalType) q = q.eq("signal_type", signalType)
    if (signalTypePrefix) q = q.like("signal_type", `${signalTypePrefix}%`)
    if (since) q = q.gte("created_at", since)
    if (!includePii) q = q.eq("pii_masked", false)

    const { data, error } = await q
    if (error) {
      return NextResponse.json({ error: "DB_ERROR", message: error.message }, { status: 500 })
    }
    const rows = data ?? []

    if (format === "csv") {
      const header = [
        "id",
        "store_uuid",
        "signal_type",
        "raw_value",
        "corrected_value",
        "pii_masked",
        "source_model",
        "source_prompt_version",
        "created_at",
      ]
      const lines = [header.join(",")]
      for (const r of rows as Array<Record<string, unknown>>) {
        lines.push(header.map((k) => csvEscape(r[k])).join(","))
      }
      // UTF-8 BOM for Excel KR compatibility.
      const body = "﻿" + lines.join("\r\n") + "\r\n"
      return new Response(body, {
        status: 200,
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="learning_signals_${Date.now()}.csv"`,
        },
      })
    }

    return NextResponse.json({
      count: rows.length,
      limited: rows.length === limit,
      filter: {
        target_store_uuid: targetStore,
        signal_type: signalType,
        signal_type_prefix: signalTypePrefix,
        since,
        include_pii: includePii,
        limit,
      },
      rows,
    })
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
