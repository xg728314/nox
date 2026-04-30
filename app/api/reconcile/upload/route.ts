import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { uploadPaperLedger } from "@/lib/storage/paperLedgerBucket"
import { logAuditEvent } from "@/lib/audit/logEvent"
import { resolveFeatureAccess, RECONCILE_ROLE_DEFAULTS } from "@/lib/auth/featureAccess"
import type { SheetKind } from "@/lib/reconcile/types"

/**
 * POST /api/reconcile/upload
 *
 * R27: 종이장부 사진 업로드.
 *
 * Multipart form fields:
 *   file:           이미지 (jpg/png/heic/webp, ≤10MB)
 *   sheet_kind:     'rooms' | 'staff' | 'other'
 *   business_date:  'YYYY-MM-DD'
 *
 * 권한: owner / manager 만 (실장/사장이 마감 후 업로드).
 *
 * 흐름:
 *   1. snapshot_id 미리 생성 (Storage 경로에 사용)
 *   2. Storage 업로드
 *   3. paper_ledger_snapshots row 생성 (status='uploaded')
 *   4. business_date 로 store_operating_days lookup → business_day_id 채움 (best-effort)
 *
 * 반환: { snapshot_id, storage_path, status }
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const VALID_SHEET_KINDS: ReadonlySet<SheetKind> = new Set(["rooms", "staff", "other"])

function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key)
}

export async function POST(request: Request) {
  try {
    const auth = await resolveAuthContext(request)

    const form = await request.formData().catch(() => null)
    if (!form) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "multipart/form-data 필요." }, { status: 400 })
    }

    const file = form.get("file")
    const sheetKindRaw = String(form.get("sheet_kind") ?? "")
    const businessDate = String(form.get("business_date") ?? "")

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "file 필드 필수." }, { status: 400 })
    }
    if (!VALID_SHEET_KINDS.has(sheetKindRaw as SheetKind)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "sheet_kind 는 rooms/staff/other." }, { status: 400 })
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "business_date 는 YYYY-MM-DD." }, { status: 400 })
    }

    const supabase = supa()

    // R-Auth: business_date 별 edit 권한 검증 (snapshot 만들기 전)
    const access = await resolveFeatureAccess(supabase, auth, {
      table: "paper_ledger_access_grants",
      store_uuid: auth.store_uuid,
      business_date: businessDate,
      action: "edit",
      role_defaults: RECONCILE_ROLE_DEFAULTS,
    })
    if (!access.allowed) {
      return NextResponse.json(
        { error: "ACCESS_DENIED", message: "이 날짜의 종이장부 업로드 권한이 없습니다.", via: access.via },
        { status: 403 },
      )
    }

    const snapshotId = crypto.randomUUID()

    // 1) Storage 업로드
    const arrayBuf = await file.arrayBuffer()
    const upload = await uploadPaperLedger(supabase, {
      store_uuid: auth.store_uuid,
      business_date: businessDate,
      snapshot_id: snapshotId,
      bytes: Buffer.from(arrayBuf),
      mime_type: file.type || "image/jpeg",
      file_name: file.name,
    })
    if (!upload.ok) {
      return NextResponse.json(
        { error: upload.reason.toUpperCase(), message: upload.message ?? upload.reason },
        { status: upload.reason === "too_large" ? 413 : 400 },
      )
    }

    // 2) business_day_id best-effort lookup
    let business_day_id: string | null = null
    try {
      const { data } = await supabase
        .from("store_operating_days")
        .select("id")
        .eq("store_uuid", auth.store_uuid)
        .eq("business_date", businessDate)
        .maybeSingle()
      business_day_id = (data as { id?: string } | null)?.id ?? null
    } catch { /* best-effort */ }

    // 2026-05-01 R-Paper-Retention: 매장별 보관 기간 조회 후 expires_at 계산.
    //   store_settings.paper_ledger_retention_days = 0 또는 null → 자동 만료 X.
    //   default 30 일.
    let expiresAt: string | null = null
    try {
      const { data: settings } = await supabase
        .from("store_settings")
        .select("paper_ledger_retention_days")
        .eq("store_uuid", auth.store_uuid)
        .maybeSingle()
      const days = (settings as { paper_ledger_retention_days?: number } | null)
        ?.paper_ledger_retention_days
      if (typeof days === "number" && days > 0) {
        expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
      } else if (days === undefined) {
        // settings row 없으면 default 30일.
        expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      }
      // days === 0 또는 null → expiresAt = null (자동 만료 안 함).
    } catch { /* best-effort, expiresAt null 로 진행 */ }

    // 3) snapshot row 생성
    const { error: insErr } = await supabase
      .from("paper_ledger_snapshots")
      .insert({
        id: snapshotId,
        store_uuid: auth.store_uuid,
        business_day_id,
        business_date: businessDate,
        sheet_kind: sheetKindRaw,
        storage_path: upload.storage_path,
        file_name: file.name,
        mime_type: file.type || null,
        size_bytes: file.size,
        status: "uploaded",
        uploaded_by: auth.user_id,
        expires_at: expiresAt,
      })
    if (insErr) {
      return NextResponse.json(
        { error: "DB_INSERT_FAILED", message: insErr.message },
        { status: 500 },
      )
    }

    await logAuditEvent(supabase, {
      auth,
      action: "paper_ledger_uploaded",
      entity_table: "paper_ledger_snapshots",
      entity_id: snapshotId,
      status: "success",
      metadata: { sheet_kind: sheetKindRaw, business_date: businessDate, size: file.size },
    })

    return NextResponse.json({
      snapshot_id: snapshotId,
      storage_path: upload.storage_path,
      status: "uploaded",
    })
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
