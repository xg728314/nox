import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"

type ForwardResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string }

async function forwardJson<T>(origin: string, path: string, cookie: string): Promise<ForwardResult<T>> {
  try {
    const r = await fetch(`${origin}${path}`, {
      method: "GET",
      headers: cookie ? { cookie } : {},
      cache: "no-store",
    })
    if (!r.ok) return { ok: false, status: r.status, error: `HTTP_${r.status}` }
    return { ok: true, data: (await r.json()) as T }
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : "network" }
  }
}

function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

type MembershipShape = {
  membership_id: string
  store_uuid: string
  store_name: string
  role: string
  is_primary: boolean
}

async function loadMemberships(userId: string): Promise<MembershipShape[]> {
  const s = supa()
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

  const cookie = request.headers.get("cookie") ?? ""
  const origin = new URL(request.url).origin

  const [profileR, staffR, overviewR, chatR, membershipsR] = await Promise.all([
    forwardJson<Record<string, unknown>>(origin, "/api/store/profile", cookie),
    forwardJson<{ staff?: unknown[] }>(origin, "/api/store/staff", cookie),
    forwardJson<{ overview?: unknown[] }>(origin, "/api/store/settlement/overview", cookie),
    forwardJson<{ unread_count?: number }>(origin, "/api/chat/unread", cookie),
    (async () => {
      try {
        const list = await loadMemberships(auth.user_id)
        return { ok: true as const, data: list }
      } catch (e) {
        return { ok: false as const, status: 500, error: e instanceof Error ? e.message : "memberships_failed" }
      }
    })(),
  ])

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
