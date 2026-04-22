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

  const [dashboardR, hostessesR, settlementR, attendanceR, chatR, participantsR, visibilityR] = await Promise.all([
    forwardJson<Record<string, unknown>>(origin, "/api/manager/dashboard", cookie),
    forwardJson<{ hostesses?: unknown[] }>(origin, "/api/manager/hostesses", cookie),
    forwardJson<Record<string, unknown>>(origin, "/api/manager/settlement/summary", cookie),
    forwardJson<{ attendance?: unknown[] }>(origin, "/api/attendance", cookie),
    forwardJson<{ unread_count?: number }>(origin, "/api/chat/unread", cookie),
    forwardJson<{ participants?: unknown[] }>(origin, "/api/manager/participants", cookie),
    forwardJson<Record<string, unknown>>(origin, "/api/manager/visibility", cookie),
  ])

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
