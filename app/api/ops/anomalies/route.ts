/**
 * GET /api/ops/anomalies
 *
 * 매장의 실시간 이상 상황 감지. 홈 배너 + 사장 대시보드용.
 *
 * 감지 규칙:
 *   1. imminent_auto_close — 8~10분 초과 세션 (곧 자동 종료 임박)
 *   2. dispatch_stuck     — 30분 이상 pending 상태 dispatch
 *   3. zombie_session     — 6시간+ active 인 session (마감 안 됨)
 *   4. inventory_low      — 재고 임계치 이하 품목
 *   5. cron_stale         — heartbeat 1시간+ 없음
 *
 * 응답:
 *   { anomalies: [{ code, severity, count, detail, url? }] }
 *
 * 권한: owner / manager. super_admin 은 매장 전체.
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"

type Anomaly = {
  code: string
  severity: "critical" | "warning" | "info"
  count: number
  detail: string
  url?: string
}

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner" && auth.role !== "manager" && !auth.is_super_admin) {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }
    const supabase = getServiceClient()
    const anomalies: Anomaly[] = []
    const now = Date.now()

    // ─── 1. imminent auto-close (8~10분 초과 active 참여자) ───
    {
      const { data: parts } = await supabase
        .from("session_participants")
        .select("id, entered_at, time_minutes, store_uuid")
        .eq("status", "active")
        .eq("store_uuid", auth.store_uuid)
        .not("entered_at", "is", null)
        .not("time_minutes", "is", null)
        .is("deleted_at", null)
      type P = { id: string; entered_at: string; time_minutes: number }
      let count = 0
      for (const p of ((parts ?? []) as P[])) {
        const overdue = now - new Date(p.entered_at).getTime() - p.time_minutes * 60_000
        const overdueMin = Math.floor(overdue / 60_000)
        if (overdueMin >= 8 && overdueMin <= 10) count++
      }
      if (count > 0) {
        anomalies.push({
          code: "imminent_auto_close",
          severity: "warning",
          count,
          detail: `${count}명 곧 자동 종료 (10분 임박)`,
          url: "/m",
        })
      }
    }

    // ─── 2. dispatch stuck (30분+ pending) ───
    {
      const cutoff = new Date(now - 30 * 60_000).toISOString()
      const { data: disps } = await supabase
        .from("chat_pattern_dispatches")
        .select("id")
        .eq("target_store_uuid", auth.store_uuid)
        .eq("status", "pending")
        .lt("created_at", cutoff)
        .is("deleted_at", null)
      const count = (disps ?? []).length
      if (count > 0) {
        anomalies.push({
          code: "dispatch_stuck",
          severity: "warning",
          count,
          detail: `dispatch ${count}건 30분+ 대기`,
          url: "/m/chat",
        })
      }
    }

    // ─── 3. zombie session (6시간+ active) ───
    {
      const cutoff = new Date(now - 6 * 60 * 60_000).toISOString()
      const { data: sess } = await supabase
        .from("room_sessions")
        .select("id, started_at")
        .eq("store_uuid", auth.store_uuid)
        .eq("status", "active")
        .lt("started_at", cutoff)
        .is("deleted_at", null)
      const count = (sess ?? []).length
      if (count > 0) {
        anomalies.push({
          code: "zombie_session",
          severity: "critical",
          count,
          detail: `session ${count}개 6시간+ 마감 안 됨`,
          url: "/m",
        })
      }
    }

    // ─── 4. inventory low (임계 이하) ───
    //   inventory_items 테이블에 min_qty 컬럼이 있다는 전제. 없으면 스킵.
    try {
      const { data: items } = await supabase
        .from("inventory_items")
        .select("id, name, current_qty, min_qty")
        .eq("store_uuid", auth.store_uuid)
        .is("deleted_at", null)
      type Item = {
        id: string
        name: string
        current_qty: number | null
        min_qty: number | null
      }
      const low = ((items ?? []) as Item[]).filter(
        (i) => i.min_qty != null && i.current_qty != null && i.current_qty <= i.min_qty,
      )
      if (low.length > 0) {
        anomalies.push({
          code: "inventory_low",
          severity: "warning",
          count: low.length,
          detail: `재고 부족 ${low.length}개 (${low.slice(0, 2).map((i) => i.name).join(", ")}${low.length > 2 ? " 외" : ""})`,
          url: "/inventory",
        })
      }
    } catch { /* inventory 테이블 없거나 컬럼 부재 — skip */ }

    // ─── 5. cron stale (1시간+ 없음) — super_admin 만 노출 ───
    if (auth.is_super_admin) {
      try {
        const cutoff = new Date(now - 60 * 60_000).toISOString()
        const { data: crons } = await supabase
          .from("cron_heartbeats")
          .select("cron_name, last_run_at")
          .lt("last_run_at", cutoff)
        const count = (crons ?? []).length
        if (count > 0) {
          anomalies.push({
            code: "cron_stale",
            severity: "critical",
            count,
            detail: `cron ${count}개 1시간+ 미실행`,
            url: "/ops/watchdog",
          })
        }
      } catch { /* heartbeat 테이블 부재 */ }
    }

    return NextResponse.json({ anomalies })
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
