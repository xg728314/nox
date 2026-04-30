import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"

/**
 * STEP-NEXT-API — GET /api/owner/accounts
 *
 * Owner-only same-store account list.
 *
 * Filters (query string):
 *   q       — search across full_name / nickname / phone / email
 *   status  — one of pending|approved|rejected|suspended
 *   role    — one of owner|manager|hostess
 *   page    — 1-based, default 1
 *   limit   — default 50, max 200
 *   sort    — created_at|updated_at, default created_at
 *
 * Strict rules:
 *   - role gate BEFORE any DB access (owner only)
 *   - all reads scoped by authContext.store_uuid
 *   - membership is the authority source (profiles.store_uuid ignored)
 */
export async function GET(request: Request) {
  try {
    // ─── Auth + role gate (BEFORE DB) ───────────────────────────
    const authContext = await resolveAuthContext(request)
    if (authContext.role !== "owner") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }

    const url = new URL(request.url)
    const q = (url.searchParams.get("q") ?? "").trim()
    const statusFilter = url.searchParams.get("status")
    const roleFilter = url.searchParams.get("role")
    const sort = url.searchParams.get("sort") === "updated_at" ? "updated_at" : "created_at"
    const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1)
    const limitRaw = Number(url.searchParams.get("limit") ?? "50") || 50
    const limit = Math.min(200, Math.max(1, limitRaw))
    const offset = (page - 1) * limit

    const VALID_STATUS = new Set(["pending", "approved", "rejected", "suspended"])
    const VALID_ROLES = new Set(["owner", "manager", "hostess"])
    if (statusFilter && !VALID_STATUS.has(statusFilter)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "invalid status filter" }, { status: 400 })
    }
    if (roleFilter && !VALID_ROLES.has(roleFilter)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "invalid role filter" }, { status: 400 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // ─── Query memberships (store-scoped) ───────────────────────
    let query = supabase
      .from("store_memberships")
      .select("id, profile_id, role, status, created_at, updated_at, approved_by, approved_at", { count: "exact" })
      .eq("store_uuid", authContext.store_uuid)
      .is("deleted_at", null)
      .order(sort, { ascending: false })
      .range(offset, offset + limit - 1)

    if (statusFilter) query = query.eq("status", statusFilter)
    if (roleFilter) query = query.eq("role", roleFilter)

    const { data: memberships, error, count } = await query
    if (error) {
      return NextResponse.json({ error: "QUERY_FAILED" }, { status: 500 })
    }

    type MembershipRow = {
      id: string
      profile_id: string
      role: string
      status: string
      created_at: string
      updated_at: string
      approved_by: string | null
      approved_at: string | null
    }
    const rows = (memberships ?? []) as MembershipRow[]

    // ─── Profile join ───────────────────────────────────────────
    //   2026-04-30 fix: profiles 테이블에 email 컬럼이 없음 (auth.users 에만
    //   존재). 이전엔 .select(..., email) 호출 시 PostgREST 가 에러 반환
    //   → profiles 가 빈 배열 → 모든 row 의 full_name 이 null 로 fallback
    //   (UI 가 user_id prefix 표시) — "신명호 가입 기록 없음" 처럼 보이는
    //   증상의 진짜 원인. profiles 는 full_name/nickname/phone 만 fetch,
    //   email 은 별도 auth.users 에서 lookup.
    const profileIds = [...new Set(rows.map((r) => r.profile_id))]
    type ProfileLite = { id: string; full_name: string | null; nickname: string | null; phone: string | null }
    const profileMap = new Map<string, ProfileLite>()
    const emailMap = new Map<string, string>()
    if (profileIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name, nickname, phone")
        .in("id", profileIds)
      for (const p of (profiles ?? []) as ProfileLite[]) profileMap.set(p.id, p)

      // email 은 auth.users 에서. listUsers 는 페이지네이션이므로 listUsers
      //   대신 직접 admin SDK 의 getUserById 를 ID 별 호출은 RTT 폭증.
      //   profile_id 가 auth.users.id 와 동일하므로 Promise.all 로 일괄 조회.
      try {
        const userResults = await Promise.all(
          profileIds.map((id) => supabase.auth.admin.getUserById(id)),
        )
        for (const r of userResults) {
          const u = r.data?.user
          if (u?.id && u?.email) emailMap.set(u.id, u.email)
        }
      } catch { /* email 조회 실패 시 null fallback (UI 영향 X) */ }
    }

    // ─── q filter (post-fetch, since fields live across tables) ─
    const qLower = q.toLowerCase()
    const enriched = rows
      .map((m) => {
        const p = profileMap.get(m.profile_id)
        return {
          membership_id: m.id,
          profile_id: m.profile_id,
          full_name: p?.full_name ?? null,
          nickname: p?.nickname ?? null,
          phone: p?.phone ?? null,
          email: emailMap.get(m.profile_id) ?? null,
          role: m.role,
          status: m.status,
          created_at: m.created_at,
          updated_at: m.updated_at,
          approved_by: m.approved_by,
          approved_at: m.approved_at,
        }
      })
      .filter((r) => {
        if (!qLower) return true
        return (
          (r.full_name ?? "").toLowerCase().includes(qLower) ||
          (r.nickname ?? "").toLowerCase().includes(qLower) ||
          (r.phone ?? "").toLowerCase().includes(qLower) ||
          (r.email ?? "").toLowerCase().includes(qLower)
        )
      })

    return NextResponse.json({
      store_uuid: authContext.store_uuid,
      page,
      limit,
      total: count ?? enriched.length,
      accounts: enriched,
    })
  } catch (error) {
    if (error instanceof AuthError) {
      const status = error.type === "AUTH_MISSING" || error.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: error.type }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
