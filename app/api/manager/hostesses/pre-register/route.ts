/**
 * 스태프 사전등록 — /api/manager/hostesses/pre-register
 *
 * 2026-06-12 R-phantom-immediate:
 *   기존: hostess_pre_registrations 에 row 만 INSERT → "가입 대기" 상태.
 *   스태프가 /signup 으로 가입 후에만 정식 식구.
 *
 *   변경: 실장/사장이 등록하는 즉시 정식 식구 (hostesses + store_memberships
 *   approved). placeholder phantom auth user (랜덤 secure 비번 + 내부 이메일)
 *   로 NOT NULL 제약 충족. 세션 참여/정산 즉시 가능.
 *
 *   차후 스태프 본인이 /signup 으로 가입 시:
 *     - 전화 + 이름 매칭 phantom profile 찾음 (이메일 도메인 `@nox-phantom.local`)
 *     - admin.updateUserById 로 email + password 갱신 → 진짜 계정으로 전환
 *     - profile.full_name 그대로, profile 의 phone 그대로. row UUID 그대로.
 *
 *   감사용으로 hostess_pre_registrations 에 row 도 INSERT (linked_* 즉시 채움).
 *
 * POST: 실장/사장이 이름+전화로 식구 즉시 등록.
 * GET:  사전등록 row 목록 (감사용).
 */
import { NextResponse } from "next/server"
import { randomBytes } from "node:crypto"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"

/** 010-1234-5678 → 01012345678 */
function normalizePhone(raw: string): string {
  return String(raw ?? "").replace(/\D/g, "")
}

function bad(error: string, message: string, status = 400) {
  return NextResponse.json({ error, message }, { status })
}

/** phantom 이메일 — 외부 도달 불가 + phantom 식별용 */
const PHANTOM_DOMAIN = "nox-phantom.local"
function phantomEmail(phone: string): string {
  const rand = randomBytes(4).toString("hex")
  return `phantom-${phone}-${rand}@${PHANTOM_DOMAIN}`
}
/** 보안 random 비번 — phantom 의 로그인 차단용 (스태프 본인 가입 시 admin API 로 교체) */
function phantomPassword(): string {
  return randomBytes(32).toString("base64url")
}

export async function POST(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "manager" && auth.role !== "owner") {
      return bad("ROLE_FORBIDDEN", "실장 또는 사장만 식구 추가 가능합니다.", 403)
    }

    let body: { name?: string; phone?: string; stage_name?: string; note?: string }
    try {
      body = await request.json()
    } catch {
      return bad("BAD_REQUEST", "Invalid JSON", 400)
    }

    const name = String(body.name ?? "").trim()
    const phone = normalizePhone(String(body.phone ?? ""))
    const stageName = body.stage_name ? String(body.stage_name).trim() : null
    const note = body.note ? String(body.note).trim() : null

    if (!name || name.length > 60) return bad("BAD_REQUEST", "이름은 1~60자.", 400)
    if (phone.length < 9 || phone.length > 15) return bad("BAD_REQUEST", "전화번호는 9~15자리 숫자.", 400)

    const supabase = getServiceClient()

    // ─── 중복 검사 ───
    // 같은 매장에 이미 등록된 식구 (활성 hostess) 가 있는지
    const hostessExisting = await supabase
      .from("hostesses")
      .select("id, name")
      .eq("store_uuid", auth.store_uuid)
      .eq("phone", phone)
      .eq("is_active", true)
      .is("deleted_at", null)
      .maybeSingle()
    if (hostessExisting.data) {
      return bad("DUPLICATE_PHONE", `이미 같은 번호로 등록된 식구가 있습니다 (${hostessExisting.data.name}).`, 409)
    }

    // ─── 1. phantom auth user 생성 ───
    const email = phantomEmail(phone)
    const password = phantomPassword()
    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: name, phone, phantom: true },
    })
    if (createErr || !created?.user) {
      console.error("[pre-register] phantom createUser failed:", createErr)
      return bad("AUTH_CREATE_FAILED", `phantom user 생성 실패: ${createErr?.message}`, 500)
    }
    const userId = created.user.id

    // rollback helper
    const rollback = async (reason: string) => {
      try {
        await supabase.auth.admin.deleteUser(userId)
      } catch (e) {
        console.error("[pre-register] rollback deleteUser failed:", reason, e)
      }
    }

    // ─── 2. profile upsert ───
    const { error: profErr } = await supabase
      .from("profiles")
      .upsert(
        { id: userId, full_name: name, phone, is_active: true },
        { onConflict: "id" },
      )
    if (profErr) {
      await rollback(`profile: ${profErr.message}`)
      return bad("PROFILE_WRITE_FAILED", `profile 생성 실패: ${profErr.message}`, 500)
    }

    // ─── 3. store_memberships insert (status=approved 즉시) ───
    const { data: memData, error: memErr } = await supabase
      .from("store_memberships")
      .insert({
        profile_id: userId,
        store_uuid: auth.store_uuid,
        role: "hostess",
        status: "approved",
        is_primary: true,
        approved_at: new Date().toISOString(),
        approved_by: auth.user_id,
      })
      .select("id")
      .single()
    if (memErr || !memData) {
      try { await supabase.from("profiles").delete().eq("id", userId) } catch { /* best-effort */ }
      await rollback(`membership: ${memErr?.message}`)
      return bad("MEMBERSHIP_WRITE_FAILED", `membership 생성 실패: ${memErr?.message}`, 500)
    }
    const membershipId = memData.id

    // ─── 4. hostesses insert ───
    const hostessInsert: Record<string, unknown> = {
      store_uuid: auth.store_uuid,
      membership_id: membershipId,
      manager_membership_id: auth.role === "manager" ? auth.membership_id : null,
      name,
      stage_name: stageName,
      phone,
      is_active: true,
    }

    /** PostgREST: column missing 패턴 — 42703 / PGRST204 / "schema cache" / "Could not find" */
    function isMissingColumn(err: { code?: string; message?: string } | null): boolean {
      if (!err) return false
      if (err.code === "42703" || err.code === "PGRST204") return true
      const m = err.message ?? ""
      return /schema cache|Could not find the '/.test(m)
    }

    // origin_store_uuid 컬럼이 있으면 같이 set (graceful — 컬럼 없으면 빼고 재시도)
    let hostessRow: { id: string } | null = null
    {
      const full = await supabase
        .from("hostesses")
        .insert({ ...hostessInsert, origin_store_uuid: auth.store_uuid })
        .select("id")
        .single()
      if (full.error && isMissingColumn(full.error)) {
        const base = await supabase
          .from("hostesses")
          .insert(hostessInsert)
          .select("id")
          .single()
        if (base.error || !base.data) {
          try { await supabase.from("store_memberships").delete().eq("id", membershipId) } catch { /* best-effort */ }
          try { await supabase.from("profiles").delete().eq("id", userId) } catch { /* best-effort */ }
          await rollback(`hostess base: ${base.error?.message}`)
          return bad("HOSTESS_WRITE_FAILED", `hostess 생성 실패 (base): ${base.error?.message}`, 500)
        }
        hostessRow = base.data
      } else if (full.error || !full.data) {
        try { await supabase.from("store_memberships").delete().eq("id", membershipId) } catch { /* best-effort */ }
        try { await supabase.from("profiles").delete().eq("id", userId) } catch { /* best-effort */ }
        await rollback(`hostess: ${full.error?.message}`)
        return bad("HOSTESS_WRITE_FAILED", `hostess 생성 실패: ${full.error?.message}`, 500)
      } else {
        hostessRow = full.data
      }
    }

    // ─── 5. 감사용 hostess_pre_registrations row (linked_* 즉시 채움) ───
    // 미적용 (42P01) 이거나 실패해도 정식 식구 생성은 성공 → swallow.
    try {
      await supabase
        .from("hostess_pre_registrations")
        .insert({
          store_uuid: auth.store_uuid,
          manager_membership_id: auth.role === "manager" ? auth.membership_id : null,
          name,
          phone,
          stage_name: stageName,
          note,
          linked_membership_id: membershipId,
          linked_hostess_id: hostessRow.id,
          linked_at: new Date().toISOString(),
        })
    } catch {
      /* audit best-effort */
    }

    return NextResponse.json(
      {
        ok: true,
        hostess: {
          id: hostessRow.id,
          membership_id: membershipId,
          name,
          phone,
          is_phantom: true,
        },
        message: "식구 즉시 등록 완료. 스태프가 같은 전화+이름으로 가입하면 계정 자동 전환.",
      },
      { status: 201 },
    )
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.type, message: error.message }, { status: error.status })
    }
    console.error("[pre-register] internal:", error)
    return NextResponse.json({ error: "INTERNAL_ERROR", message: String(error) }, { status: 500 })
  }
}

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "manager" && auth.role !== "owner") {
      return bad("ROLE_FORBIDDEN", "Access denied.", 403)
    }

    const supabase = getServiceClient()
    const q =
      auth.role === "owner"
        ? supabase
            .from("hostess_pre_registrations")
            .select("id, name, phone, stage_name, note, created_at, linked_membership_id, linked_hostess_id, manager_membership_id")
            .eq("store_uuid", auth.store_uuid)
            .is("deleted_at", null)
            .order("created_at", { ascending: false })
        : supabase
            .from("hostess_pre_registrations")
            .select("id, name, phone, stage_name, note, created_at, linked_membership_id, linked_hostess_id, manager_membership_id")
            .eq("store_uuid", auth.store_uuid)
            .eq("manager_membership_id", auth.membership_id)
            .is("deleted_at", null)
            .order("created_at", { ascending: false })

    const { data, error } = await q
    if (error) {
      if ((error as { code?: string }).code === "42P01") {
        return NextResponse.json({ pre_registrations: [], migration_required: true })
      }
      return bad("QUERY_FAILED", error.message, 500)
    }
    return NextResponse.json({ pre_registrations: data ?? [] })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.type, message: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
