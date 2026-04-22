import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getManagerDashboard } from "@/lib/server/queries/managerDashboard"
import { getManagerHostesses } from "@/lib/server/queries/managerHostesses"
import { getManagerSettlementSummary } from "@/lib/server/queries/managerSettlementSummary"
import { getAttendance } from "@/lib/server/queries/attendance"
import { getChatUnread } from "@/lib/server/queries/chatUnread"
import { getManagerParticipants } from "@/lib/server/queries/managerParticipants"
import { getManagerVisibility } from "@/lib/server/queries/managerVisibility"

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

  if (!(auth.role === "manager" || auth.role === "owner" || auth.is_super_admin)) {
    return NextResponse.json({ error: "ROLE_FORBIDDEN", message: "manager/owner only" }, { status: 403 })
  }

  const tStart = Date.now()

  const [dashboardR, hostessesR, settlementR, attendanceR, chatR, participantsR, visibilityR] = await Promise.all([
    slot("manager", "dashboard", () => getManagerDashboard(auth)),
    slot("manager", "hostesses", () => getManagerHostesses(auth)),
    slot("manager", "settlement", () => getManagerSettlementSummary(auth)),
    slot("manager", "attendance", () => getAttendance(auth)),
    slot("manager", "chat_unread", () => getChatUnread(auth)),
    slot("manager", "participants", () => getManagerParticipants(auth)),
    slot("manager", "visibility", () => getManagerVisibility(auth)),
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
