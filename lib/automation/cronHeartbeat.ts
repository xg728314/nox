/**
 * Cron heartbeat — 사일런트 실패 가시화.
 *
 * R24 (2026-04-25): Vercel cron 4종이 실제로 돌고 있는지 외부 신호 없이
 *   알 방법이 없었음. 각 cron 라우트가 시작/종료 시 `stampCronHeartbeat` 를
 *   호출 → `cron_heartbeats` 테이블에 흔적 → watchdog 이 stale 검출.
 *
 * 사용 (cron 라우트 시작):
 *   await stampCronHeartbeat(supabase, "ops-alerts-scan", "started")
 *   ... 작업 ...
 *   await stampCronHeartbeat(supabase, "ops-alerts-scan", "success")
 *   // 또는 실패 시:
 *   await stampCronHeartbeat(supabase, "ops-alerts-scan", "failed", err.message)
 *
 * 실패 시 cron 본 처리에 영향 주지 않도록 try/catch 내부 흡수 — heartbeat
 *   실패가 cron 자체를 죽이면 안 된다.
 */

import type { SupabaseClient } from "@supabase/supabase-js"

export type CronName =
  | "ops-alerts-scan"
  | "ble-attendance-sync"
  | "ble-session-inference"
  | "ble-history-reaper"
  | "audit-archive"
  | "settlement-tree-advance"

/** cron 등록 정보 + stale 임계치 (분). vercel.json 의 schedule 과 동기화. */
export const CRON_REGISTRY: Record<CronName, {
  schedule: string
  /** 이 시간(분) 이상 last_run_at 이 경과하면 stale. cron 주기의 ~3배. */
  staleThresholdMin: number
  description: string
}> = {
  "ops-alerts-scan": {
    schedule: "*/5 * * * *",
    staleThresholdMin: 15,
    description: "근태 이상 스캔 + Telegram 알림",
  },
  "ble-attendance-sync": {
    schedule: "*/2 * * * *",
    staleThresholdMin: 10,
    description: "BLE 출퇴근 동기화",
  },
  "ble-session-inference": {
    schedule: "*/2 * * * *",
    staleThresholdMin: 10,
    description: "BLE 기반 세션 자동 추론",
  },
  "ble-history-reaper": {
    schedule: "0 3 * * *",
    staleThresholdMin: 26 * 60, // 일 1회 + 약간의 여유
    description: "BLE 히스토리 정리 (일 1회)",
  },
  "audit-archive": {
    schedule: "0 18 * * *", // 03:00 KST
    staleThresholdMin: 26 * 60,
    description: "audit_events 90일 초과분 archive 이동 (일 1회)",
  },
  "settlement-tree-advance": {
    schedule: "0 8 * * *", // 17:00 KST
    staleThresholdMin: 26 * 60,
    description: "정산 트리 1→2→3 단계 진행 + 만료/완료 삭제 (일 1회)",
  },
}

export type CronPhase = "started" | "success" | "failed"

/**
 * cron 실행 흔적 stamp. 실패해도 throw 하지 않음 (cron 본체 보호).
 */
export async function stampCronHeartbeat(
  supabase: SupabaseClient,
  cronName: CronName,
  phase: CronPhase,
  error?: string,
): Promise<void> {
  try {
    const now = new Date().toISOString()

    if (phase === "started") {
      // started 는 last_run_at 만 갱신 + run_count_total +1.
      await fallbackUpsert(supabase, cronName, { last_run_at: now }, true)
      return
    }

    if (phase === "success") {
      await fallbackUpsert(supabase, cronName, {
        last_run_at: now,
        last_success_at: now,
        last_error: null,
      }, false)
      return
    }

    if (phase === "failed") {
      await fallbackUpsert(supabase, cronName, {
        last_run_at: now,
        last_error: (error ?? "unknown error").slice(0, 500),
      }, false, true)
      return
    }
  } catch (e) {
    // 어떤 이유로든 heartbeat 실패는 cron 본체 결과에 영향 없어야 한다.
    // eslint-disable-next-line no-console
    console.warn(`[cronHeartbeat] stamp swallowed: ${(e as Error).message}`)
  }
}

async function fallbackUpsert(
  supabase: SupabaseClient,
  cronName: CronName,
  fields: Record<string, unknown>,
  incTotal: boolean,
  incFailed: boolean = false,
): Promise<void> {
  // PostgREST 에서 직접 increment 어려움 — read-modify-write.
  const { data: existing } = await supabase
    .from("cron_heartbeats")
    .select("run_count_total, run_count_failed")
    .eq("cron_name", cronName)
    .maybeSingle()

  const totalNext = (existing?.run_count_total ?? 0) + (incTotal ? 1 : 0)
  const failedNext = (existing?.run_count_failed ?? 0) + (incFailed ? 1 : 0)

  await supabase
    .from("cron_heartbeats")
    .upsert(
      {
        cron_name: cronName,
        ...fields,
        run_count_total: totalNext,
        run_count_failed: failedNext,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "cron_name" },
    )
}

/**
 * 모든 cron heartbeat 조회 + stale 분류.
 *   stale: last_run_at 이 staleThresholdMin 이상 경과
 *   never_run: heartbeat row 자체가 없음 (배포 직후 또는 cron 한 번도 안 돌음)
 *   recently_failed: last_run_at - last_success_at 이 임계치 이상
 */
export type CronHealth = {
  cron_name: CronName
  schedule: string
  description: string
  stale_threshold_min: number
  status: "ok" | "stale" | "never_run" | "recently_failed"
  last_run_at: string | null
  last_success_at: string | null
  last_error: string | null
  run_count_total: number
  run_count_failed: number
  minutes_since_last_run: number | null
}

export async function getCronHealth(
  supabase: SupabaseClient,
): Promise<CronHealth[]> {
  const { data: rows } = await supabase
    .from("cron_heartbeats")
    .select("cron_name, last_run_at, last_success_at, last_error, run_count_total, run_count_failed")

  const byName = new Map<string, NonNullable<typeof rows>[number]>()
  for (const r of rows ?? []) byName.set(r.cron_name as string, r)

  const now = Date.now()
  const result: CronHealth[] = []

  for (const [name, info] of Object.entries(CRON_REGISTRY)) {
    const cronName = name as CronName
    const r = byName.get(cronName)

    if (!r || !r.last_run_at) {
      result.push({
        cron_name: cronName,
        schedule: info.schedule,
        description: info.description,
        stale_threshold_min: info.staleThresholdMin,
        status: "never_run",
        last_run_at: null,
        last_success_at: null,
        last_error: null,
        run_count_total: 0,
        run_count_failed: 0,
        minutes_since_last_run: null,
      })
      continue
    }

    const lastRunMs = new Date(r.last_run_at).getTime()
    const ageMin = (now - lastRunMs) / 60_000

    let status: CronHealth["status"] = "ok"
    if (ageMin > info.staleThresholdMin) {
      status = "stale"
    } else if (
      r.last_success_at &&
      new Date(r.last_run_at).getTime() - new Date(r.last_success_at).getTime() >
        info.staleThresholdMin * 60_000
    ) {
      status = "recently_failed"
    }

    result.push({
      cron_name: cronName,
      schedule: info.schedule,
      description: info.description,
      stale_threshold_min: info.staleThresholdMin,
      status,
      last_run_at: r.last_run_at as string,
      last_success_at: (r.last_success_at as string) ?? null,
      last_error: (r.last_error as string) ?? null,
      run_count_total: Number(r.run_count_total ?? 0),
      run_count_failed: Number(r.run_count_failed ?? 0),
      minutes_since_last_run: Math.round(ageMin),
    })
  }

  return result
}
