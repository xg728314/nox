/**
 * GET /api/cron/push-imminent
 *
 * 임박 세션 감지 → 관련 매니저에게 push 알림.
 *   조건: entered_at + time_minutes 계산한 종료 예정 시각이
 *         지금부터 5~10분 이내인 active 참여자.
 *   - 이미 종료 지난 (음수) 건은 제외.
 *   - tag: `imminent-<session_id>` 로 같은 세션 중복 push 방지 (renotify).
 *   - manager_membership_id → store_memberships.profile_id → user_id 조회 후 send.
 *
 * 스케줄: 5분마다 (GitHub Actions).
 * 보안: Authorization: Bearer <CRON_SECRET>.
 *
 * R-push (2026-06-28).
 */
import { NextResponse } from "next/server"
import { timingSafeEqual } from "crypto"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { sendPushToUser } from "@/lib/push/send"

function verifyBearer(headerVal: string | null, secret: string): boolean {
  if (!headerVal || !secret) return false
  const prefix = "Bearer "
  if (!headerVal.startsWith(prefix)) return false
  const a = Buffer.from(headerVal.slice(prefix.length))
  const b = Buffer.from(secret)
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

const IMMINENT_MIN = 5
const IMMINENT_MAX = 10

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET ?? ""
  const authHeader = request.headers.get("authorization")
  if (!verifyBearer(authHeader, cronSecret)) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 })
  }

  const supabase = getServiceClient()

  // 1. active 참여자 조회 — entered_at + time_minutes 있음
  const { data: parts } = await supabase
    .from("session_participants")
    .select("id, session_id, membership_id, entered_at, time_minutes, store_uuid")
    .eq("status", "active")
    .not("entered_at", "is", null)
    .not("time_minutes", "is", null)
    .is("deleted_at", null)
  type Part = {
    id: string
    session_id: string
    membership_id: string
    entered_at: string
    time_minutes: number
    store_uuid: string
  }
  const rows = (parts ?? []) as Part[]
  const now = Date.now()

  // 2. 임박 세션 필터 (5~10분 남음)
  type Imminent = {
    session_id: string
    store_uuid: string
    remaining_min: number
    hostess_names: string[]
    hostess_mids: string[]
  }
  const bySession = new Map<string, Imminent>()
  for (const p of rows) {
    const endMs = new Date(p.entered_at).getTime() + p.time_minutes * 60_000
    const remainMs = endMs - now
    const remainMin = Math.floor(remainMs / 60_000)
    if (remainMin < IMMINENT_MIN || remainMin > IMMINENT_MAX) continue
    let s = bySession.get(p.session_id)
    if (!s) {
      s = {
        session_id: p.session_id,
        store_uuid: p.store_uuid,
        remaining_min: remainMin,
        hostess_names: [],
        hostess_mids: [p.membership_id],
      }
      bySession.set(p.session_id, s)
    } else {
      s.hostess_mids.push(p.membership_id)
      s.remaining_min = Math.min(s.remaining_min, remainMin)
    }
  }

  if (bySession.size === 0) {
    return NextResponse.json({ ok: true, notified: 0, imminent: 0 })
  }

  // 3. 세션별 room + manager 조회 (JOIN — session_id in ...)
  const sessionIds = [...bySession.keys()]
  const { data: sessions } = await supabase
    .from("room_sessions")
    .select("id, manager_membership_id, room_uuid, rooms!inner(room_no)")
    .in("id", sessionIds)
  type SessRow = {
    id: string
    manager_membership_id: string | null
    room_uuid: string
    rooms: { room_no: string } | { room_no: string }[] | null
  }
  const sessMap = new Map<string, SessRow>()
  for (const s of ((sessions ?? []) as SessRow[])) sessMap.set(s.id, s)

  // 4. hostess 이름 매핑
  const allMids = [...bySession.values()].flatMap((s) => s.hostess_mids)
  const { data: hRows } = await supabase
    .from("hostesses")
    .select("membership_id, name")
    .in("membership_id", allMids)
  const nameByMid = new Map<string, string>()
  for (const h of ((hRows ?? []) as Array<{ membership_id: string; name: string | null }>)) {
    if (h.name) nameByMid.set(h.membership_id, h.name)
  }

  // 5. manager membership → user_id 매핑
  const managerMids = [...sessMap.values()]
    .map((s) => s.manager_membership_id)
    .filter((v): v is string => !!v)
  const { data: mRows } = await supabase
    .from("store_memberships")
    .select("id, profile_id")
    .in("id", managerMids)
  const userByMid = new Map<string, string>()
  for (const m of ((mRows ?? []) as Array<{ id: string; profile_id: string | null }>)) {
    if (m.profile_id) userByMid.set(m.id, m.profile_id)
  }

  // 6. 매니저별 push
  //    같은 매니저가 여러 임박 세션 있으면 각각 별도 push (tag 로 dedupe).
  let notified = 0
  for (const [sid, imm] of bySession) {
    const sess = sessMap.get(sid)
    if (!sess?.manager_membership_id) continue
    const userId = userByMid.get(sess.manager_membership_id)
    if (!userId) continue
    const roomObj = Array.isArray(sess.rooms) ? sess.rooms[0] : sess.rooms
    const roomNo = roomObj?.room_no ?? "?"
    const hostessNames = imm.hostess_mids
      .map((mid) => nameByMid.get(mid))
      .filter(Boolean)
      .join(", ")
    const result = await sendPushToUser(userId, {
      title: `⏰ ${imm.remaining_min}분 남음 · ${roomNo}번방`,
      body: hostessNames ? `${hostessNames}` : "곧 종료 예정",
      url: "/m",
      tag: `imminent-${sid}`,
    })
    notified += result.ok
  }

  return NextResponse.json({
    ok: true,
    imminent: bySession.size,
    notified,
  })
}
