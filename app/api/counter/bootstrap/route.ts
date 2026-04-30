import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getChatUnread } from "@/lib/server/queries/chatUnread"
import { getInventoryItems } from "@/lib/server/queries/inventoryItems"
import { getManagerHostessStats } from "@/lib/server/queries/manager/hostessStats"
import { getStoreStaff } from "@/lib/server/queries/store/staff"
import {
  getUserPreferencesBundle,
  getForcedPreferencesBundle,
} from "@/lib/server/queries/preferences"

// 2026-04-30 R-Perf-PrefBundle: 카운터 페이지가 자주 쓰는 prefs scope 화이트리스트.
//   클라가 ensureLoaded 시점에 고를 수 있는 모든 scope 를 사전에 fetch.
//   (3 user + 2 forced = 5 round trip → 0)
const COUNTER_PREF_SCOPES_USER = [
  "daily_ops_check",
  "counter.sidebar_menu",
  "counter.room_layout",
] as const
const COUNTER_PREF_SCOPES_FORCED = [
  "counter.sidebar_menu",
  "counter.room_layout",
] as const

function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key)
}

/**
 * /api/counter/bootstrap — 카운터 페이지 mount 시 한 번에 묶음 fetch.
 *
 * 2026-04-30 cleanup: rooms slot 제거. useCounterBootstrap (client) 는
 *   chat_unread / inventory / hostess_stats / hostess_pool 만 사용. rooms 는
 *   별도 useRooms hook 가 /api/rooms 로 fetch + realtime 구독 + polling 한다.
 *   기존엔 server 가 rooms 도 헛수고로 한 번 더 query 했음. 클라 미사용 +
 *   server CPU 낭비라 slot 자체 제거 (응답에서 rooms 필드도 빠짐).
 *
 *   useCounterBootstrap 의 fallback 로직 (`if (data.rooms)`) 는 이미 없음 —
 *   ts 안전. grep 으로 다른 사용처 0건 확인.
 *
 * 응답 shape: { chat_unread, inventory, hostess_stats, hostess_pool, errors, generated_at }
 */

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
  const supabase = supa()

  const [chatR, inventoryR, hostessStatsR, hostessPoolR, prefUserR, prefForcedR] =
    await Promise.all([
      slot("counter", "chat_unread", () => getChatUnread(auth)),
      slot("counter", "inventory", () => getInventoryItems(auth)),
      slot("counter", "hostess_stats", () => getManagerHostessStats(auth)),
      slot("counter", "hostess_pool", () => getStoreStaff(auth, { role: "hostess" })),
      slot("counter", "pref_user", () =>
        getUserPreferencesBundle(supabase, auth, [...COUNTER_PREF_SCOPES_USER]),
      ),
      slot("counter", "pref_forced", () =>
        getForcedPreferencesBundle(supabase, auth, [...COUNTER_PREF_SCOPES_FORCED]),
      ),
    ])
  console.log(JSON.stringify({ tag: "perf.bootstrap.total", route: "counter", ms: Date.now() - tStart }))

  return NextResponse.json({
    chat_unread: chatR.ok ? (chatR.data.unread_count ?? 0) : null,
    inventory: inventoryR.ok ? inventoryR.data : null,
    hostess_stats: hostessStatsR.ok ? hostessStatsR.data : null,
    hostess_pool: hostessPoolR.ok ? (hostessPoolR.data.staff ?? []) : null,
    // 2026-04-30 R-Perf-PrefBundle: preferences 다중 scope 한 번에 hydrate.
    //   client preferencesStore.hydrateBundle 이 받아서 ensureLoaded skip.
    //   기존 5번 round trip (각 1초+) → 0번. 효과 명확.
    preferences: {
      user: prefUserR.ok ? prefUserR.data : null,
      forced: prefForcedR.ok ? prefForcedR.data : null,
    },
    errors: {
      chat_unread: chatR.ok ? null : chatR.error,
      inventory: inventoryR.ok ? null : inventoryR.error,
      hostess_stats: hostessStatsR.ok ? null : hostessStatsR.error,
      hostess_pool: hostessPoolR.ok ? null : hostessPoolR.error,
      pref_user: prefUserR.ok ? null : prefUserR.error,
      pref_forced: prefForcedR.ok ? null : prefForcedR.error,
    },
    generated_at: new Date().toISOString(),
  })
}
