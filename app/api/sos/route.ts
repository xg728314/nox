/**
 * POST /api/sos
 *   SOS 발동. 매장 owner + manager 에게 즉시 push.
 *   Body: { kind?: 'help'|'complaint'|'emergency', message?: string, session_id?: string, room_uuid?: string }
 *
 * GET /api/sos
 *   내 매장 active SOS 목록 (owner/manager 전용).
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { sendPushToUser } from "@/lib/push/send"

export async function POST(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    const body = (await request.json().catch(() => ({}))) as {
      kind?: "help" | "complaint" | "emergency"
      message?: string
      session_id?: string
      room_uuid?: string
    }
    const kind = body.kind ?? "emergency"
    const supabase = getServiceClient()

    // 1. SOS row 생성
    const { data: sos, error } = await supabase
      .from("sos_events")
      .insert({
        store_uuid: auth.store_uuid,
        sender_user_id: auth.user_id,
        sender_membership_id: auth.membership_id,
        sender_role: auth.role,
        kind,
        message: body.message ?? null,
        room_uuid: body.room_uuid ?? null,
        session_id: body.session_id ?? null,
      })
      .select("id")
      .single()
    if (error) {
      return NextResponse.json(
        { error: "INSERT_FAILED", message: error.message },
        { status: 500 },
      )
    }
    const sosId = (sos as { id: string }).id

    // 2. 매장의 owner / manager 조회
    const { data: recipients } = await supabase
      .from("store_memberships")
      .select("id, profile_id, role")
      .eq("store_uuid", auth.store_uuid)
      .eq("status", "approved")
      .in("role", ["owner", "manager"])
      .neq("profile_id", auth.user_id) // 발신자 제외
    type R = { id: string; profile_id: string | null; role: string }
    const targets = ((recipients ?? []) as R[])
      .map((r) => r.profile_id)
      .filter((v): v is string => !!v)

    // 3. 병렬 push (best-effort, 실패 무시)
    const kindLabel =
      kind === "help" ? "🆘 도움 요청" : kind === "complaint" ? "😠 컴플레인" : "🚨 긴급 상황"
    const notified: string[] = []
    await Promise.all(
      targets.map(async (uid) => {
        try {
          const r = await sendPushToUser(uid, {
            title: kindLabel,
            body: body.message ?? `${auth.role} 이(가) SOS 를 보냈습니다.`,
            url: "/m",
            tag: `sos-${sosId}`,
            data: { sos_id: sosId },
          })
          if (r.ok > 0) notified.push(uid)
        } catch {}
      }),
    )

    // 4. 알림 stamp
    if (notified.length > 0) {
      await supabase
        .from("sos_events")
        .update({
          first_notified_at: new Date().toISOString(),
          notified_user_ids: notified,
        })
        .eq("id", sosId)
    }

    return NextResponse.json({ ok: true, id: sosId, notified: notified.length })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json(
      { error: "INTERNAL", message: e instanceof Error ? e.message : "err" },
      { status: 500 },
    )
  }
}

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner" && auth.role !== "manager") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }
    const supabase = getServiceClient()
    const { data } = await supabase
      .from("sos_events")
      .select(
        "id, kind, message, sender_role, sender_user_id, room_uuid, created_at",
      )
      .eq("store_uuid", auth.store_uuid)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(10)
    return NextResponse.json({ events: data ?? [] })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 })
  }
}
