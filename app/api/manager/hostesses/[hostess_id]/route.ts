import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"

/**
 * GET /api/manager/hostesses/[hostess_id]
 *
 * Manager 가 본인 담당 hostess 의 상세를 조회.
 *
 * Schema (database/002_actual_schema.sql 기준):
 *   store_memberships  : id (PK), profile_id, store_uuid, role, status, deleted_at, ...
 *   hostesses          : id (PK), store_uuid, membership_id, manager_membership_id, deleted_at, ...
 *   profiles           : id (PK), full_name, nickname, ...
 *
 * Route param `hostess_id` 는 **hostess 의 store_memberships.id** 로 해석
 * (NOX 관례 — `hostesses.membership_id` = `store_memberships.id`).
 *
 * 권한:
 *   - role === "manager" 만. 그 외 403.
 *   - hostesses.manager_membership_id === auth.membership_id 자기담당 검증.
 *     불일치 → 404 HOSTESS_NOT_FOUND (존재 은닉).
 *   - store scope: hostesses.store_uuid === auth.store_uuid 강제.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ hostess_id: string }> }
) {
  try {
    const { hostess_id: hostessId } = await params
    const authContext = await resolveAuthContext(request)

    // Role gate: manager only
    if (authContext.role !== "manager") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "This endpoint is restricted to manager role." },
        { status: 403 }
      )
    }

    if (!hostessId) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "hostess_id is required." },
        { status: 400 }
      )
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { error: "SERVER_CONFIG_ERROR", message: "Supabase environment variables are not configured." },
        { status: 500 }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // ── 1. Assignment 검증: manager 가 이 hostess 를 담당하는가?
    //   SSOT: hostesses.manager_membership_id === auth.membership_id
    //   AND hostesses.membership_id === hostessId
    //   AND hostesses.store_uuid === auth.store_uuid
    const { data: assignment, error: assignmentError } = await supabase
      .from("hostesses")
      .select("id, membership_id")
      .eq("store_uuid", authContext.store_uuid)
      .eq("manager_membership_id", authContext.membership_id)
      .eq("membership_id", hostessId)
      .is("deleted_at", null)
      .maybeSingle()

    if (assignmentError) {
      return NextResponse.json(
        { error: "QUERY_FAILED", message: "Assignment lookup failed." },
        { status: 500 }
      )
    }
    if (!assignment) {
      return NextResponse.json(
        { error: "HOSTESS_NOT_FOUND", message: "Hostess not found or not assigned to this manager." },
        { status: 404 }
      )
    }

    // ── 2. Hostess membership 확인 + 이름 해석 (2-step, join 없이).
    const { data: membership, error: membershipError } = await supabase
      .from("store_memberships")
      .select("id, profile_id")
      .eq("id", hostessId)
      .eq("store_uuid", authContext.store_uuid)
      .eq("role", "hostess")
      .is("deleted_at", null)
      .maybeSingle()

    if (membershipError) {
      return NextResponse.json(
        { error: "QUERY_FAILED", message: "Membership lookup failed." },
        { status: 500 }
      )
    }
    if (!membership) {
      return NextResponse.json(
        { error: "HOSTESS_NOT_FOUND", message: "Hostess membership not found." },
        { status: 404 }
      )
    }

    // ── 3. Name resolution — hostesses.name 우선 (operator 표시명),
    //   fallback 으로 profiles.full_name.
    const { data: hostessRow } = await supabase
      .from("hostesses")
      .select("name, stage_name")
      .eq("id", assignment.id)
      .is("deleted_at", null)
      .maybeSingle()

    let resolvedName: string | null = null
    if (hostessRow) {
      const stage = typeof hostessRow.stage_name === "string" ? hostessRow.stage_name.trim() : ""
      const n = typeof hostessRow.name === "string" ? hostessRow.name.trim() : ""
      resolvedName = stage || n || null
    }
    if (!resolvedName && membership.profile_id) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", membership.profile_id)
        .is("deleted_at", null)
        .maybeSingle()
      const fn = typeof profile?.full_name === "string" ? profile.full_name.trim() : ""
      resolvedName = fn || null
    }

    return NextResponse.json({
      store_uuid: authContext.store_uuid,
      role: authContext.role,
      hostess: {
        hostess_id: membership.id,
        hostess_name: resolvedName,
      },
    })
  } catch (error) {
    if (error instanceof AuthError) {
      const status =
        error.type === "AUTH_MISSING" ? 401 :
        error.type === "AUTH_INVALID" ? 401 :
        error.type === "MEMBERSHIP_NOT_FOUND" ? 403 :
        error.type === "MEMBERSHIP_INVALID" ? 403 :
        error.type === "MEMBERSHIP_NOT_APPROVED" ? 403 :
        error.type === "SERVER_CONFIG_ERROR" ? 500 :
        500

      return NextResponse.json(
        { error: error.type, message: error.message },
        { status }
      )
    }

    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Unexpected error." },
      { status: 500 }
    )
  }
}
