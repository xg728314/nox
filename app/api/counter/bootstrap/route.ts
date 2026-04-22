import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"

type ForwardResult<T> = { ok: true; data: T; ms: number } | { ok: false; status: number; error: string; ms: number }

// P0-4: per-slot timing to Vercel logs.
async function forwardJson<T>(
  routeTag: string,
  slot: string,
  origin: string,
  path: string,
  cookie: string,
): Promise<ForwardResult<T>> {
  const t0 = Date.now()
  try {
    const r = await fetch(`${origin}${path}`, {
      method: "GET",
      headers: cookie ? { cookie } : {},
      cache: "no-store",
    })
    const ms = Date.now() - t0
    if (!r.ok) {
      console.log(JSON.stringify({ tag: "perf.bootstrap.slot", route: routeTag, slot, path, ok: false, status: r.status, ms }))
      return { ok: false, status: r.status, error: `HTTP_${r.status}`, ms }
    }
    const data = (await r.json()) as T
    const msTotal = Date.now() - t0
    console.log(JSON.stringify({ tag: "perf.bootstrap.slot", route: routeTag, slot, path, ok: true, status: r.status, ms: msTotal }))
    return { ok: true, data, ms: msTotal }
  } catch (e) {
    const ms = Date.now() - t0
    const err = e instanceof Error ? e.message : "network"
    console.log(JSON.stringify({ tag: "perf.bootstrap.slot", route: routeTag, slot, path, ok: false, status: 0, error: err, ms }))
    return { ok: false, status: 0, error: err, ms }
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
  const tStart = Date.now()

  const [roomsR, chatR, inventoryR, hostessStatsR, hostessPoolR] = await Promise.all([
    forwardJson<Record<string, unknown>>("counter", "rooms", origin, "/api/rooms", cookie),
    forwardJson<{ unread_count?: number }>("counter", "chat_unread", origin, "/api/chat/unread", cookie),
    forwardJson<Record<string, unknown>>("counter", "inventory", origin, "/api/inventory/items", cookie),
    forwardJson<Record<string, unknown>>("counter", "hostess_stats", origin, "/api/manager/hostess-stats", cookie),
    forwardJson<{ staff?: unknown[] }>("counter", "hostess_pool", origin, "/api/store/staff?role=hostess", cookie),
  ])
  console.log(JSON.stringify({ tag: "perf.bootstrap.total", route: "counter", ms: Date.now() - tStart }))

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
