import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { logAuditEvent } from "@/lib/audit/logEvent"
import { isValidUUID } from "@/lib/validation"

/**
 * /api/reconcile/grants
 *
 * R-Auth: 종이장부 권한 (paper_ledger_access_grants) 의 owner-only 관리.
 *
 * GET  → 매장의 active grant 목록 (owner 화면용)
 * POST → 신규 grant 부여
 *
 * 권한:
 *   - owner only (모든 grant 가 owner 의 의식적 결정)
 *   - manager 가 자기 자신에 grant 부여하는 self-promotion 차단
 *
 * 정책:
 *   - 모든 grant 에 expires_at 필수 (영구 grant 금지)
 *   - max 만료 = 1년 (정책 안전장치)
 *   - 같은 매장 내 membership 만 부여 가능 (cross-store grant 차단)
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_GRANT_DAYS = 365  // 영구 회피 — 1년 hard cap

type GrantKind = "extend" | "restrict" | "require_review"
type GrantAction = "view" | "edit" | "review"
type ScopeType = "single_date" | "date_range" | "all_dates"

const VALID_KINDS = new Set<GrantKind>(["extend", "restrict", "require_review"])
const VALID_ACTIONS = new Set<GrantAction>(["view", "edit", "review"])
const VALID_SCOPES = new Set<ScopeType>(["single_date", "date_range", "all_dates"])

function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key)
}

// ─── GET: 매장 active grant 목록 ──────────────────────────────
export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN", message: "owner 만 권한 목록을 볼 수 있습니다." }, { status: 403 })
    }

    const url = new URL(request.url)
    const includeExpired = url.searchParams.get("include_expired") === "1"
    const includeRevoked = url.searchParams.get("include_revoked") === "1"

    const supabase = supa()
    let query = supabase
      .from("paper_ledger_access_grants")
      .select("id, store_uuid, membership_id, kind, action, scope_type, business_date, date_start, date_end, granted_by, granted_at, expires_at, revoked_at, revoked_by, reason")
      .eq("store_uuid", auth.store_uuid)
      .order("granted_at", { ascending: false })
      .limit(500)

    if (!includeRevoked) {
      query = query.is("revoked_at", null)
    }
    if (!includeExpired) {
      query = query.gt("expires_at", new Date().toISOString())
    }

    const { data, error } = await query
    if (error) {
      return NextResponse.json({ error: "DB_ERROR", message: error.message }, { status: 500 })
    }

    return NextResponse.json({ items: data ?? [] })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}

// ─── POST: 신규 grant 부여 ────────────────────────────────────
export async function POST(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN", message: "owner 만 권한을 부여할 수 있습니다." }, { status: 403 })
    }

    const body = (await request.json().catch(() => ({}))) as {
      membership_id?: unknown
      kind?: unknown
      action?: unknown
      scope_type?: unknown
      business_date?: unknown
      date_start?: unknown
      date_end?: unknown
      expires_at?: unknown
      reason?: unknown
    }

    // ─── 입력 검증 ───────────────────────────────────────────
    const membership_id = String(body.membership_id ?? "")
    const kind = String(body.kind ?? "")
    const action = String(body.action ?? "")
    const scope_type = String(body.scope_type ?? "")
    const expires_at_raw = String(body.expires_at ?? "")
    const reason = typeof body.reason === "string" ? body.reason.trim() || null : null

    if (!isValidUUID(membership_id)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "membership_id 는 UUID." }, { status: 400 })
    }
    if (!VALID_KINDS.has(kind as GrantKind)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "kind 는 extend|restrict|require_review." }, { status: 400 })
    }
    if (!VALID_ACTIONS.has(action as GrantAction)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "action 은 view|edit|review." }, { status: 400 })
    }
    if (!VALID_SCOPES.has(scope_type as ScopeType)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "scope_type 은 single_date|date_range|all_dates." }, { status: 400 })
    }

    // expires_at: ISO + 미래 + 1년 이내
    const expiresDate = new Date(expires_at_raw)
    if (Number.isNaN(expiresDate.getTime())) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "expires_at 은 유효한 ISO timestamp." }, { status: 400 })
    }
    const now = new Date()
    if (expiresDate <= now) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "expires_at 은 미래여야 합니다." }, { status: 400 })
    }
    const maxExpires = new Date(now.getTime() + MAX_GRANT_DAYS * 24 * 60 * 60 * 1000)
    if (expiresDate > maxExpires) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: `expires_at 은 최대 ${MAX_GRANT_DAYS}일 이내.` },
        { status: 400 },
      )
    }

    // scope_type 별 필드 일관성 (DB CHECK 도 잡지만 명시 검증)
    let business_date: string | null = null
    let date_start: string | null = null
    let date_end: string | null = null
    const dateRe = /^\d{4}-\d{2}-\d{2}$/

    if (scope_type === "single_date") {
      const d = String(body.business_date ?? "")
      if (!dateRe.test(d)) {
        return NextResponse.json({ error: "BAD_REQUEST", message: "single_date 시 business_date YYYY-MM-DD 필수." }, { status: 400 })
      }
      business_date = d
    } else if (scope_type === "date_range") {
      const s = String(body.date_start ?? "")
      const e = String(body.date_end ?? "")
      if (!dateRe.test(s) || !dateRe.test(e)) {
        return NextResponse.json({ error: "BAD_REQUEST", message: "date_range 시 date_start/date_end YYYY-MM-DD 필수." }, { status: 400 })
      }
      if (s > e) {
        return NextResponse.json({ error: "BAD_REQUEST", message: "date_start <= date_end 이어야 합니다." }, { status: 400 })
      }
      date_start = s
      date_end = e
    }
    // all_dates: 추가 필드 없음

    const supabase = supa()

    // ─── 대상 membership 검증 (같은 매장 + 활성 + 자기 자신 X) ─
    const { data: target } = await supabase
      .from("store_memberships")
      .select("id, profile_id, store_uuid, role, status")
      .eq("id", membership_id)
      .is("deleted_at", null)
      .maybeSingle()
    if (!target) {
      return NextResponse.json({ error: "NOT_FOUND", message: "membership 을 찾을 수 없습니다." }, { status: 404 })
    }
    const t = target as { id: string; profile_id: string; store_uuid: string; role: string; status: string }
    if (t.store_uuid !== auth.store_uuid) {
      return NextResponse.json({ error: "STORE_FORBIDDEN", message: "다른 매장의 멤버십에 부여할 수 없습니다." }, { status: 403 })
    }
    if (t.status !== "approved") {
      return NextResponse.json({ error: "MEMBERSHIP_NOT_APPROVED", message: "approved 멤버십에만 부여 가능." }, { status: 409 })
    }
    if (t.id === auth.membership_id) {
      return NextResponse.json({ error: "SELF_GRANT_FORBIDDEN", message: "자기 자신에 부여할 수 없습니다 (owner 는 grant 무관 자동 통과)." }, { status: 400 })
    }

    // ─── insert ──────────────────────────────────────────────
    const { data: grant, error: insErr } = await supabase
      .from("paper_ledger_access_grants")
      .insert({
        store_uuid: auth.store_uuid,
        membership_id: t.id,
        kind,
        action,
        scope_type,
        business_date,
        date_start,
        date_end,
        granted_by: auth.user_id,
        expires_at: expiresDate.toISOString(),
        reason,
      })
      .select("id, granted_at, expires_at")
      .single()
    if (insErr) {
      return NextResponse.json({ error: "DB_INSERT_FAILED", message: insErr.message }, { status: 500 })
    }
    const g = grant as { id: string; granted_at: string; expires_at: string }

    // ─── audit ───────────────────────────────────────────────
    await logAuditEvent(supabase, {
      auth,
      action: "paper_ledger_grant_created",
      entity_table: "paper_ledger_access_grants",
      entity_id: g.id,
      status: "success",
      metadata: {
        target_membership_id: t.id,
        target_role: t.role,
        kind,
        grant_action: action,
        scope_type,
        business_date,
        date_start,
        date_end,
        expires_at: g.expires_at,
      },
      reason,
    })

    return NextResponse.json({ grant_id: g.id, granted_at: g.granted_at, expires_at: g.expires_at })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
