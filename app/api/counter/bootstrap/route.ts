import { NextResponse } from "next/server"
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

export async function GET(request: Request) {
  try {
    await resolveAuthContext(request)
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "auth failure" }, { status: 500 })
  }

  const cookie = request.headers.get("cookie") ?? ""
  const origin = new URL(request.url).origin

  const [roomsR, chatR, inventoryR, hostessStatsR, hostessPoolR] = await Promise.all([
    forwardJson<Record<string, unknown>>(origin, "/api/rooms", cookie),
    forwardJson<{ unread_count?: number }>(origin, "/api/chat/unread", cookie),
    forwardJson<Record<string, unknown>>(origin, "/api/inventory/items", cookie),
    forwardJson<Record<string, unknown>>(origin, "/api/manager/hostess-stats", cookie),
    forwardJson<{ staff?: unknown[] }>(origin, "/api/store/staff?role=hostess", cookie),
  ])

  return NextResponse.json({
    rooms: roomsR.ok ? roomsR.data : null,
    chat_unread: chatR.ok ? (chatR.data.unread_count ?? 0) : null,
    inventory: inventoryR.ok ? inventoryR.data : null,
    hostess_stats: hostessStatsR.ok ? hostessStatsR.data : null,
    hostess_pool: hostessPoolR.ok ? (hostessPoolR.data.staff ?? []) : null,
    errors: {
      rooms: roomsR.ok ? null : roomsR.error,
      chat_unread: chatR.ok ? null : chatR.error,
      inventory: inventoryR.ok ? null : inventoryR.error,
      hostess_stats: hostessStatsR.ok ? null : hostessStatsR.error,
      hostess_pool: hostessPoolR.ok ? null : hostessPoolR.error,
    },
    generated_at: new Date().toISOString(),
  })
}
