import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { isValidUUID } from "@/lib/validation"

/**
 * /api/ble/tags
 *
 * 매장 BLE 태그 (직원 착용) 관리.
 *
 * GET  : 매장의 모든 태그 + 매핑된 직원 정보 + 마지막 감지 시각.
 * POST : 새 태그 등록 (minor 번호 + 라벨 + 직원 매핑).
 *
 * 권한: owner only.
 */

export const runtime = "nodejs"

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner" && auth.role !== "manager") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "사장/매니저만 태그 조회 가능." },
        { status: 403 },
      )
    }

    const supabase = getServiceClient()

    // tags + 매장 멤버십 + 마지막 감지 (ble_tag_presence) 동시 fetch.
    const [tagsRes, memRes, presenceRes] = await Promise.all([
      supabase
        .from("ble_tags")
        .select("id, minor, membership_id, tag_label, is_active, created_at, updated_at")
        .eq("store_uuid", auth.store_uuid)
        .order("minor", { ascending: true }),
      supabase
        .from("store_memberships")
        .select("id, role, profile_id")
        .eq("store_uuid", auth.store_uuid)
        .eq("status", "approved")
        .is("deleted_at", null),
      supabase
        .from("ble_tag_presence")
        .select("minor, last_seen_at, last_event_type, room_uuid")
        .eq("store_uuid", auth.store_uuid),
    ])

    if (tagsRes.error) {
      return NextResponse.json(
        { error: "QUERY_FAILED", message: tagsRes.error.message },
        { status: 500 },
      )
    }

    const memMap = new Map<string, { id: string; role: string; profile_id: string }>()
    const profileIds: string[] = []
    for (const m of (memRes.data ?? []) as Array<{ id: string; role: string; profile_id: string }>) {
      memMap.set(m.id, m)
      if (m.profile_id) profileIds.push(m.profile_id)
    }

    // membership 의 profile name lookup
    const { data: profiles } = profileIds.length > 0
      ? await supabase.from("profiles").select("id, name").in("id", profileIds)
      : { data: [] as Array<{ id: string; name: string }> }
    const profileNameMap = new Map<string, string>()
    for (const p of profiles ?? []) profileNameMap.set(p.id, p.name)

    const presenceMap = new Map<number, { last_seen_at: string | null; last_event_type: string | null; room_uuid: string | null }>()
    for (const p of (presenceRes.data ?? []) as Array<{ minor: number; last_seen_at: string | null; last_event_type: string | null; room_uuid: string | null }>) {
      presenceMap.set(p.minor, p)
    }

    const tags = (tagsRes.data ?? []).map((t: {
      id: string
      minor: number
      membership_id: string | null
      tag_label: string | null
      is_active: boolean
      created_at: string
    }) => {
      const presence = presenceMap.get(t.minor) ?? null
      const onlineThreshold = 5 * 60 * 1000
      const isOnline = presence?.last_seen_at
        ? Date.now() - new Date(presence.last_seen_at).getTime() < onlineThreshold
        : false
      const mem = t.membership_id ? memMap.get(t.membership_id) ?? null : null
      const memberName = mem ? profileNameMap.get(mem.profile_id) ?? null : null
      return {
        id: t.id,
        minor: t.minor,
        membership_id: t.membership_id,
        member_name: memberName,
        member_role: mem?.role ?? null,
        tag_label: t.tag_label,
        is_active: t.is_active,
        last_seen_at: presence?.last_seen_at ?? null,
        last_event_type: presence?.last_event_type ?? null,
        is_online: isOnline,
        created_at: t.created_at,
      }
    })

    return NextResponse.json({ store_uuid: auth.store_uuid, tags })
  } catch (error) {
    if (error instanceof AuthError) {
      const status = error.type === "AUTH_MISSING" || error.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "사장만 태그를 등록할 수 있습니다." },
        { status: 403 },
      )
    }

    let body: {
      minor?: number
      tag_label?: string | null
      membership_id?: string | null
    }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    }

    const minor = Number(body.minor)
    if (!Number.isInteger(minor) || minor < 1 || minor > 65535) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "minor 는 1-65535 정수." },
        { status: 400 },
      )
    }

    const membershipId = body.membership_id && isValidUUID(body.membership_id)
      ? body.membership_id
      : null

    const supabase = getServiceClient()

    // 매장 내 minor 중복 확인
    const { data: existing } = await supabase
      .from("ble_tags")
      .select("id")
      .eq("store_uuid", auth.store_uuid)
      .eq("minor", minor)
      .maybeSingle()

    if (existing) {
      return NextResponse.json(
        { error: "DUPLICATE_MINOR", message: `minor ${minor} 는 이미 등록된 태그입니다.` },
        { status: 409 },
      )
    }

    // membership_id 가 있으면 매장 소속 + approved 인지 검증
    if (membershipId) {
      const { data: mem } = await supabase
        .from("store_memberships")
        .select("id")
        .eq("id", membershipId)
        .eq("store_uuid", auth.store_uuid)
        .eq("status", "approved")
        .is("deleted_at", null)
        .maybeSingle()
      if (!mem) {
        return NextResponse.json(
          { error: "MEMBERSHIP_NOT_FOUND", message: "매핑할 직원을 찾을 수 없습니다." },
          { status: 404 },
        )
      }
    }

    const { data: created, error: insertErr } = await supabase
      .from("ble_tags")
      .insert({
        store_uuid: auth.store_uuid,
        minor,
        membership_id: membershipId,
        tag_label: body.tag_label?.trim() || null,
        is_active: true,
      })
      .select("id, minor, membership_id, tag_label, is_active, created_at")
      .single()

    if (insertErr || !created) {
      return NextResponse.json(
        { error: "CREATE_FAILED", message: insertErr?.message || "등록 실패." },
        { status: 500 },
      )
    }

    void supabase
      .from("audit_events")
      .insert({
        store_uuid: auth.store_uuid,
        actor_profile_id: auth.user_id,
        actor_membership_id: auth.membership_id,
        actor_role: auth.role,
        actor_type: auth.role,
        entity_table: "ble_tags",
        entity_id: created.id,
        action: "ble_tag_registered",
        after: { minor, membership_id: membershipId, tag_label: created.tag_label },
      })
      .then(undefined, () => { /* swallow */ })

    return NextResponse.json({ tag: created }, { status: 201 })
  } catch (error) {
    if (error instanceof AuthError) {
      const status = error.type === "AUTH_MISSING" || error.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
