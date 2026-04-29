import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { getCronHealth } from "@/lib/automation/cronHeartbeat"

/**
 * GET /api/telemetry/watchdog
 *
 * 2026-04-25: 감시봇/cron/에러 현황을 한 화면에서 조회하는 대시보드 API.
 *   owner 전용. 최근 24시간 기준.
 *
 * 응답:
 *   {
 *     generated_at,
 *     telegram_configured,   // TELEGRAM_BOT_TOKEN 설정 여부
 *     cron_signals: {        // 최근 cron 동작 흔적 추정
 *       ops_alerts_scan_alive_today,
 *       ble_sync_alive_today,
 *     },
 *     errors: {
 *       total_24h, by_tag, recent_5,
 *     },
 *     auth_anomalies_24h: {
 *       login_failed,
 *       membership_invalid,    // 미등록/무효 멤버십 접근 시도
 *       forbidden_access,       // 403 발생
 *       unauthorized_access,    // 401 발생
 *     },
 *     data_anomalies: {
 *       sessions_without_manager,
 *       sessions_no_participants,
 *       long_running_sessions,     // 6시간 넘은 active
 *       duplicate_active_per_room,
 *     },
 *     open_issues_by_severity,
 *   }
 */
export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN" },
        { status: 403 },
      )
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const since24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString()

    // ── 1) Telegram 설정 체크 ──
    const telegramConfigured = !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID)

    // ── 2) 에러 집계 ──
    //   resolved_at 마킹된 행은 운영자가 "이미 수정됨" 으로 처리한 것 → 제외.
    //   원본 row 는 보존 (감사 추적). active 만 watchdog 에 카운트.
    const { data: errorRows } = await supabase
      .from("system_errors")
      .select("id, tag, error_name, error_message, created_at")
      .gte("created_at", since24h)
      .is("resolved_at", null)
      .order("created_at", { ascending: false })
    const errorList = errorRows ?? []
    const errorByTag = new Map<string, number>()
    for (const e of errorList) {
      const t = (e.tag as string) || "(untagged)"
      errorByTag.set(t, (errorByTag.get(t) ?? 0) + 1)
    }

    // ── 3) auth 이상 ──
    const { data: auditRows } = await supabase
      .from("audit_events")
      .select("action, created_at, metadata, entity_table")
      .eq("store_uuid", auth.store_uuid)
      .gte("created_at", since24h)
      .order("created_at", { ascending: false })
      .limit(500)
    let loginFailed = 0, membershipInvalid = 0, forbiddenAccess = 0, unauthorizedAccess = 0
    for (const a of auditRows ?? []) {
      const act = a.action as string
      if (act === "membership_invalid" || act === "unregistered_access") membershipInvalid++
      if (act === "forbidden_access") forbiddenAccess++
      if (act === "unauthorized_access") unauthorizedAccess++
    }
    // 2026-04-25: login_failed 는 audit_events 가 아닌 system_errors 에 기록
    //   (인증 전 단계 → store_uuid 식별 불가 → audit_events 에 NOT NULL 위반).
    const { count: loginFailedCount } = await supabase
      .from("system_errors")
      .select("*", { count: "exact", head: true })
      .eq("tag", "login_failed")
      .gte("created_at", since24h)
    loginFailed = loginFailedCount ?? 0

    // ── 4) 데이터 이상 ──
    // 4-1. 6시간 넘은 active 세션 (체크아웃 누락 의심)
    const sixHoursAgo = new Date(Date.now() - 6 * 3600 * 1000).toISOString()
    const { count: longRunning } = await supabase
      .from("room_sessions")
      .select("*", { count: "exact", head: true })
      .eq("store_uuid", auth.store_uuid)
      .eq("status", "active")
      .lt("started_at", sixHoursAgo)
      .is("archived_at", null)

    // 4-2. active 세션 중 실장 이름/ID 둘 다 없는 것 (오랜 문제 검출)
    const { count: noManager } = await supabase
      .from("room_sessions")
      .select("*", { count: "exact", head: true })
      .eq("store_uuid", auth.store_uuid)
      .eq("status", "active")
      .is("manager_name", null)
      .is("manager_membership_id", null)
      .is("archived_at", null)

    // 4-3. 같은 방에 active 세션 2개 이상
    const { data: dupCandidates } = await supabase
      .from("room_sessions")
      .select("room_uuid")
      .eq("store_uuid", auth.store_uuid)
      .eq("status", "active")
      .is("archived_at", null)
    const roomCounts = new Map<string, number>()
    for (const r of dupCandidates ?? []) {
      roomCounts.set(r.room_uuid, (roomCounts.get(r.room_uuid) ?? 0) + 1)
    }
    const duplicateActivePerRoom = [...roomCounts.values()].filter(c => c > 1).length

    // ── 5) 이슈 심각도 집계 ──
    const { data: issueRows } = await supabase
      .from("issue_reports")
      .select("severity, status")
      .eq("store_uuid", auth.store_uuid)
      .in("status", ["open", "in_review"])
      .is("deleted_at", null)
    const openIssuesBySev = { critical: 0, high: 0, medium: 0, low: 0 }
    for (const it of issueRows ?? []) {
      const s = it.severity as keyof typeof openIssuesBySev
      if (s in openIssuesBySev) openIssuesBySev[s]++
    }

    // ── 6) cron health — R24: cron_heartbeats 기반 실제 실행 추적.
    //    각 cron 라우트가 시작 시 stamp → 임계치 초과면 stale.
    //    이전엔 "Vercel 대시보드 가서 보세요" 였지만 이제 직접 가시화됨.
    const cronHealth = await getCronHealth(supabase).catch(() => [])
    const cronSignals = {
      crons: cronHealth,
      stale_count: cronHealth.filter(c => c.status === "stale" || c.status === "never_run").length,
      total: cronHealth.length,
    }

    // R28-fix: DB health 시그널. v_index_usage / v_table_stats view 사용.
    //   migration 094 미적용 환경에선 silent (catch).
    let dbHealth: {
      unused_index_count?: number
      large_dead_ratio_tables?: Array<{ table: string; dead: number; live: number }>
    } = {}
    try {
      const { data: idxRows } = await supabase
        .from("v_index_usage")
        .select("index_name, idx_scan")
        .eq("idx_scan", 0)
      const { data: tblRows } = await supabase
        .from("v_table_stats")
        .select("table_name, live_rows, dead_rows")
      dbHealth = {
        unused_index_count: (idxRows ?? []).length,
        large_dead_ratio_tables: (tblRows ?? [])
          .filter((r) => {
            const row = r as { live_rows?: number; dead_rows?: number }
            const live = Number(row.live_rows ?? 0)
            const dead = Number(row.dead_rows ?? 0)
            return live > 1000 && dead > live * 0.2  // dead 가 live 의 20% 초과
          })
          .map((r) => {
            const row = r as { table_name: string; live_rows: number; dead_rows: number }
            return { table: row.table_name, dead: row.dead_rows, live: row.live_rows }
          }),
      }
    } catch { /* migration 094 미적용 — silent */ }

    return NextResponse.json({
      generated_at: new Date().toISOString(),
      telegram_configured: telegramConfigured,
      cron_signals: cronSignals,
      db_health: dbHealth,
      errors: {
        total_24h: errorList.length,
        by_tag: [...errorByTag.entries()].map(([tag, count]) => ({ tag, count }))
          .sort((a, b) => b.count - a.count),
        recent_5: errorList.slice(0, 5).map(e => ({
          tag: e.tag,
          error_name: e.error_name,
          error_message: e.error_message,
          created_at: e.created_at,
        })),
      },
      auth_anomalies_24h: {
        login_failed: loginFailed,
        membership_invalid: membershipInvalid,
        forbidden_access: forbiddenAccess,
        unauthorized_access: unauthorizedAccess,
      },
      data_anomalies: {
        long_running_sessions: longRunning ?? 0,
        sessions_without_manager: noManager ?? 0,
        duplicate_active_per_room: duplicateActivePerRoom,
      },
      open_issues_by_severity: openIssuesBySev,
    })
  } catch (error) {
    if (error instanceof AuthError) {
      const status =
        error.type === "AUTH_MISSING" || error.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
