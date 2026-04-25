import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getRooms } from "@/lib/server/queries/rooms"
import { getChatUnread } from "@/lib/server/queries/chatUnread"
import { getInventoryItems } from "@/lib/server/queries/inventoryItems"
import { getManagerHostessStats } from "@/lib/server/queries/manager/hostessStats"
import { getStoreStaff } from "@/lib/server/queries/store/staff"

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

  const tStart = Date.now()

  const [roomsR, chatR, inventoryR, hostessStatsR, hostessPoolR] = await Promise.all([
    slot("counter", "rooms", () => getRooms(auth)),
    slot("counter", "chat_unread", () => getChatUnread(auth)),
    slot("counter", "inventory", () => getInventoryItems(auth)),
    slot("counter", "hostess_stats", () => getManagerHostessStats(auth)),
    slot("counter", "hostess_pool", () => getStoreStaff(auth, { role: "hostess" })),
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
