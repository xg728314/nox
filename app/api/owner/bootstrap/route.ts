import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { getStoreProfile } from "@/lib/server/queries/storeProfile"
import { getStoreStaff } from "@/lib/server/queries/storeStaff"
import { getStoreSettlementOverview } from "@/lib/server/queries/storeSettlementOverview"
import { getChatUnread } from "@/lib/server/queries/chatUnread"

type MembershipShape = {
  membership_id: string
  store_uuid: string
  store_name: string
  role: string
  is_primary: boolean
}

async function loadMemberships(userId: string): Promise<MembershipShape[]> {
  const s = getServiceClient()
  const { data: memberships, error } = await s
    .from("store_memberships")
    .select("id, store_uuid, role, status, is_primary")
    .eq("profile_id", userId)
    .eq("status", "approved")
    .is("deleted_at", null)
    .order("is_primary", { ascending: false })
  if (error) throw new Error("QUERY_FAILED")
  type Row = { id: string; store_uuid: string; role: string; is_primary: boolean }
  const rows = (memberships ?? []) as Row[]
  const storeUuids = [...new Set(rows.map((m) => m.store_uuid))]
  const storeMap = new Map<string, string>()
  if (storeUuids.length > 0) {
    const { data: stores } = await s.from("stores").select("id, store_name").in("id", storeUuids)
    for (const st of stores ?? []) storeMap.set(st.id, st.store_name)
  }
  return rows.map((m) => ({
    membership_id: m.id,
    store_uuid: m.store_uuid,
    store_name: storeMap.get(m.store_uuid) || "",
    role: m.role,
    is_primary: m.is_primary,
  }))
}

async function slot<T>(
  routeTag: string,
  slotName: string,
  fn: () => Promise<T>,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const t0 = Date.now()
  try {
    const data = await fn()
    const ms = Date.now() - t0
    console.log(JSON.stringify({ tag: "perf.bootstrap.slot", route: routeTag, slot: slotName, ok: true, ms }))
    return { ok: true, data }
  } catch (e) {
    const ms = Date.now() - t0
    const error = e instanceof Error ? e.message : "err"
    console.log(JSON.stringify({ tag: "perf.bootstrap.slot", route: routeTag, slot: slotName, ok: false, error, ms }))
    return { ok: false, error }
  }
}

export async function GET(request: Request) {
  let auth
  try {
    auth = await resolveAuthContext(request)
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "auth failure" }, { status: 500 })
  }

  if (!(auth.role === "owner" || auth.is_super_admin)) {
    return NextResponse.json({ error: "ROLE_FORBIDDEN", message: "owner only" }, { status: 403 })
  }

  const tStart = Date.now()

  const [profileR, staffR, overviewR, chatR, membershipsR] = await Promise.all([
    slot("owner", "profile", () => getStoreProfile(auth)),
    slot("owner", "staff", () => getStoreStaff(auth)),
    slot("owner", "overview", () => getStoreSettlementOverview(auth)),
    slot("owner", "chat_unread", () => getChatUnread(auth)),
    slot("owner", "memberships", () => loadMemberships(auth.user_id)),
  ])
  console.log(JSON.stringify({ tag: "perf.bootstrap.total", route: "owner", ms: Date.now() - tStart }))

  return NextResponse.json({
    profile: profileR.ok ? profileR.data : null,
    staff: staffR.ok ? (staffR.data.staff ?? []) : null,
    overview: overviewR.ok ? (overviewR.data.overview ?? []) : null,
    memberships: membershipsR.ok ? membershipsR.data : null,
    chat_unread: chatR.ok ? (chatR.data.unread_count ?? 0) : null,
    rooms: null,
    items: null,
    preferences: null,
    errors: {
      profile: profileR.ok ? null : profileR.error,
      staff: staffR.ok ? null : staffR.error,
      overview: overviewR.ok ? null : overviewR.error,
      memberships: membershipsR.ok ? null : membershipsR.error,
      chat_unread: chatR.ok ? null : chatR.error,
    },
    generated_at: new Date().toISOString(),
  })
}
