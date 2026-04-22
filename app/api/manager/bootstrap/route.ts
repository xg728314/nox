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

  if (!(auth.role === "manager" || auth.role === "owner" || auth.is_super_admin)) {
    return NextResponse.json({ error: "ROLE_FORBIDDEN", message: "manager/owner only" }, { status: 403 })
  }

  const cookie = request.headers.get("cookie") ?? ""
  const origin = new URL(request.url).origin
  const tStart = Date.now()

  const [dashboardR, hostessesR, settlementR, attendanceR, chatR, participantsR, visibilityR] = await Promise.all([
    forwardJson<Record<string, unknown>>("manager", "dashboard", origin, "/api/manager/dashboard", cookie),
    forwardJson<{ hostesses?: unknown[] }>("manager", "hostesses", origin, "/api/manager/hostesses", cookie),
    forwardJson<Record<string, unknown>>("manager", "settlement", origin, "/api/manager/settlement/summary", cookie),
    forwardJson<{ attendance?: unknown[] }>("manager", "attendance", origin, "/api/attendance", cookie),
    forwardJson<{ unread_count?: number }>("manager", "chat_unread", origin, "/api/chat/unread", cookie),
    forwardJson<{ participants?: unknown[] }>("manager", "participants", origin, "/api/manager/participants", cookie),
    forwardJson<Record<string, unknown>>("manager", "visibility", origin, "/api/manager/visibility", cookie),
  ])
  console.log(JSON.stringify({ tag: "perf.bootstrap.total", route: "manager", ms: Date.now() - tStart }))

  return NextResponse.json({
    dashboard: dashboardR.ok ? dashboardR.data : null,
    hostesses: hostessesR.ok ? (hostessesR.data.hostesses ?? []) : null,
    settlement: settlementR.ok ? settlementR.data : null,
    attendance: attendanceR.ok ? (attendanceR.data.attendance ?? []) : null,
    chat_unread: chatR.ok ? (chatR.data.unread_count ?? 0) : null,
    participants: participantsR.ok ? (participantsR.data.participants ?? []) : null,
    visibility: visibilityR.ok ? visibilityR.data : null,
    errors: {
      dashboard: dashboardR.ok ? null : dashboardR.error,
      hostesses: hostessesR.ok ? null : hostessesR.error,
      settlement: settlementR.ok ? null : settlementR.error,
      attendance: attendanceR.ok ? null : attendanceR.error,
      chat_unread: chatR.ok ? null : chatR.error,
      participants: participantsR.ok ? null : participantsR.error,
      visibility: visibilityR.ok ? null : visibilityR.error,
    },
    generated_at: new Date().toISOString(),
  })
}
