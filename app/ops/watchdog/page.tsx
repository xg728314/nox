"use client"

/**
 * 통합 감시 대시보드 (owner).
 *
 * 2026-04-25: 감시봇/cron/에러/auth이상/데이터이상/이슈 현황을 한 화면에서.
 *   5분마다 자동 새로고침. 수동 새로고침 버튼.
 */

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"

type CronHealth = {
  cron_name: string
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

type Watchdog = {
  generated_at: string
  telegram_configured: boolean
  cron_signals: {
    crons?: CronHealth[]
    stale_count?: number
    total?: number
  } & Record<string, unknown>
  errors: {
    total_24h: number
    by_tag: Array<{ tag: string; count: number }>
    recent_5: Array<{ tag: string | null; error_name: string | null; error_message: string | null; created_at: string }>
  }
  auth_anomalies_24h: {
    login_failed: number
    membership_invalid: number
    forbidden_access: number
    unauthorized_access: number
  }
  data_anomalies: {
    long_running_sessions: number
    sessions_without_manager: number
    duplicate_active_per_room: number
  }
  /** R-watchdog-v2 (2026-04-30): 매일 운영자가 봐야 할 회계/운영 신호. */
  ops_anomalies?: {
    unclosed_old_days: number
    stale_draft_receipts: number
    old_unpaid_credits: number
    negative_stock: number
    below_min_stock: number
  }
  open_issues_by_severity: { critical: number; high: number; medium: number; low: number }
}

export default function WatchdogPage() {
  const router = useRouter()
  const [data, setData] = useState<Watchdog | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [lastFetched, setLastFetched] = useState<Date | null>(null)
  const [testSending, setTestSending] = useState(false)
  const [testResult, setTestResult] = useState("")

  async function load() {
    setLoading(true)
    setError("")
    try {
      const res = await apiFetch("/api/telemetry/watchdog")
      if (res.status === 401 || res.status === 403) {
        router.push("/login")
        return
      }
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.message || "조회 실패")
        return
      }
      setData(await res.json())
      setLastFetched(new Date())
    } catch {
      setError("네트워크 오류")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    const id = setInterval(load, 5 * 60 * 1000) // 5분 자동 새로고침
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function sendTestAlert() {
    if (testSending) return
    setTestSending(true)
    setTestResult("")
    try {
      const res = await apiFetch("/api/telemetry/test-alert", { method: "POST" })
      const d = await res.json().catch(() => ({}))
      if (res.ok) setTestResult("✓ 테스트 알림 발송 완료 — Telegram 확인")
      else setTestResult(`실패: ${d.message || res.status}`)
    } catch {
      setTestResult("네트워크 오류")
    } finally {
      setTestSending(false)
      setTimeout(() => setTestResult(""), 5000)
    }
  }

  const a = data?.auth_anomalies_24h
  const d = data?.data_anomalies
  const i = data?.open_issues_by_severity
  const ops = data?.ops_anomalies

  const cronStaleCount = data?.cron_signals?.stale_count ?? 0
  const cronList = data?.cron_signals?.crons ?? []

  // 전체 상태 판단 — 운영 이상도 포함
  const hasAnyIssue = !!data && (
    (a?.membership_invalid ?? 0) > 0 ||
    (a?.forbidden_access ?? 0) > 5 ||
    (d?.duplicate_active_per_room ?? 0) > 0 ||
    (d?.long_running_sessions ?? 0) > 0 ||
    (i?.critical ?? 0) > 0 ||
    (i?.high ?? 0) > 0 ||
    (data?.errors.total_24h ?? 0) > 20 ||
    cronStaleCount > 0 ||
    (ops?.unclosed_old_days ?? 0) > 0 ||
    (ops?.stale_draft_receipts ?? 0) > 0 ||
    (ops?.old_unpaid_credits ?? 0) > 0 ||
    (ops?.negative_stock ?? 0) > 0
  )

  return (
    <div className="min-h-screen bg-[#030814] text-white pb-20">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-white/10">
        <button onClick={() => router.push("/counter")} className="text-cyan-400 text-sm">← 뒤로</button>
        <span className="font-semibold">🛡️ 감시 대시보드</span>
        <button
          onClick={load}
          disabled={loading}
          className="text-xs px-2.5 py-1 rounded bg-cyan-500/15 border border-cyan-500/25 text-cyan-300 disabled:opacity-50"
        >{loading ? "..." : "새로고침"}</button>
      </div>

      {error && (
        <div className="mx-4 mt-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>
      )}

      {data && (
        <div className="px-4 py-4 space-y-4">
          {/* 종합 상태 */}
          <div className={`rounded-2xl border p-4 ${
            hasAnyIssue
              ? "border-amber-500/30 bg-amber-500/5"
              : "border-emerald-500/30 bg-emerald-500/5"
          }`}>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-slate-400">전체 상태</div>
                <div className={`text-2xl font-bold mt-1 ${hasAnyIssue ? "text-amber-300" : "text-emerald-300"}`}>
                  {hasAnyIssue ? "⚠️ 주의 필요" : "✅ 정상"}
                </div>
              </div>
              {lastFetched && (
                <div className="text-right">
                  <div className="text-[10px] text-slate-500">마지막 확인</div>
                  <div className="text-xs text-slate-300">
                    {lastFetched.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </div>
                  <div className="text-[10px] text-slate-600">5분마다 자동 갱신</div>
                </div>
              )}
            </div>
          </div>

          {/* Telegram 알림 설정 */}
          <div className={`rounded-xl border p-3 ${
            data.telegram_configured
              ? "border-emerald-500/20 bg-emerald-500/5"
              : "border-amber-500/30 bg-amber-500/10"
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <div className="text-xs text-slate-400 mb-1">Telegram 실시간 알림</div>
                <div className={`text-sm font-semibold ${
                  data.telegram_configured ? "text-emerald-300" : "text-amber-300"
                }`}>
                  {data.telegram_configured
                    ? "✓ 활성 — 이상 감지 시 자동 발송"
                    : "⚠️ 비활성 — 환경변수 미설정"}
                </div>
                {/* 비활성 상태일 때 설정 가이드 */}
                {!data.telegram_configured && (
                  <div className="mt-3 pt-3 border-t border-amber-500/20 text-[11px] text-amber-200/90 space-y-2">
                    <div className="font-semibold">설정 방법:</div>
                    <ol className="list-decimal list-inside space-y-1 leading-relaxed text-amber-200/70">
                      <li>Telegram 앱에서 <code className="bg-black/30 px-1 rounded">@BotFather</code> 검색 → <code className="bg-black/30 px-1 rounded">/newbot</code> → 봇 이름 지정 → <b>토큰</b> 획득</li>
                      <li>알림 받을 개인 채팅에서 <code className="bg-black/30 px-1 rounded">@userinfobot</code> 으로 <b>chat_id</b> 확인 (또는 그룹 추가 후 그룹의 chat_id)</li>
                      <li>Vercel 프로젝트 → Settings → Environment Variables 에 추가:
                        <div className="mt-1 ml-4 font-mono text-[10px] bg-black/30 p-2 rounded">
                          TELEGRAM_BOT_TOKEN=&lt;봇 토큰&gt;<br/>
                          TELEGRAM_CHAT_ID=&lt;chat id&gt;
                        </div>
                      </li>
                      <li>Production 재배포 → 이 화면 새로고침 → ✓ 활성 확인 후 <b>테스트 알림</b> 버튼</li>
                    </ol>
                  </div>
                )}
              </div>
              {data.telegram_configured && (
                <button
                  onClick={sendTestAlert}
                  disabled={testSending}
                  className="text-xs px-3 py-1.5 rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-cyan-200 font-semibold disabled:opacity-50 shrink-0"
                >
                  {testSending ? "발송 중..." : "테스트 알림"}
                </button>
              )}
            </div>
            {testResult && (
              <div className="mt-2 text-xs text-slate-300">{testResult}</div>
            )}
          </div>

          {/* R24: Cron Heartbeat */}
          {cronList.length > 0 && (
            <div className={`rounded-xl border p-3 ${
              cronStaleCount > 0
                ? "border-red-500/40 bg-red-500/10"
                : "border-emerald-500/20 bg-emerald-500/5"
            }`}>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="text-xs text-slate-400">Cron 자동화</div>
                  <div className={`text-sm font-semibold ${
                    cronStaleCount > 0 ? "text-red-300" : "text-emerald-300"
                  }`}>
                    {cronStaleCount > 0
                      ? `⛔ ${cronStaleCount}개 멈춤 — 즉시 확인`
                      : `✓ ${cronList.length}개 정상 동작 중`}
                  </div>
                </div>
              </div>
              <div className="space-y-1.5 mt-2">
                {cronList.map(c => (
                  <div
                    key={c.cron_name}
                    className={`flex items-center justify-between text-[11px] py-1.5 px-2 rounded ${
                      c.status === "stale" || c.status === "never_run"
                        ? "bg-red-500/15"
                        : c.status === "recently_failed"
                        ? "bg-amber-500/15"
                        : "bg-white/[0.02]"
                    }`}
                    title={c.last_error ? `마지막 에러: ${c.last_error}` : ""}
                  >
                    <div className="min-w-0">
                      <span className="font-mono text-slate-300">{c.cron_name}</span>
                      <span className="text-slate-500 ml-2">{c.description}</span>
                    </div>
                    <div className="text-right shrink-0 ml-2">
                      {c.status === "ok" && (
                        <span className="text-emerald-400">✓ {c.minutes_since_last_run}분 전</span>
                      )}
                      {c.status === "stale" && (
                        <span className="text-red-300 font-semibold">
                          ⛔ {c.minutes_since_last_run}분 전 (임계 {c.stale_threshold_min}분)
                        </span>
                      )}
                      {c.status === "never_run" && (
                        <span className="text-red-300 font-semibold">⛔ 미실행</span>
                      )}
                      {c.status === "recently_failed" && (
                        <span className="text-amber-300">⚠ 최근 실패</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {cronStaleCount > 0 && (
                <div className="mt-2 text-[11px] text-red-200/80 leading-relaxed">
                  Vercel Dashboard → Settings → Cron Jobs 에서 활성 상태 확인.
                  CRON_SECRET 환경변수 설정 여부도 점검.
                </div>
              )}
            </div>
          )}

          {/* 4개 지표 그리드 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <MetricCard
              label="미등록 접근"
              value={a?.membership_invalid ?? 0}
              cls={(a?.membership_invalid ?? 0) > 0 ? "text-red-400" : "text-emerald-300"}
              hint="24시간"
            />
            <MetricCard
              label="권한 거부 (403)"
              value={a?.forbidden_access ?? 0}
              cls={(a?.forbidden_access ?? 0) > 5 ? "text-amber-400" : "text-slate-300"}
              hint="24시간"
            />
            <MetricCard
              label="인증 실패 (401)"
              value={a?.unauthorized_access ?? 0}
              cls={(a?.unauthorized_access ?? 0) > 10 ? "text-amber-400" : "text-slate-300"}
              hint="24시간"
            />
            <MetricCard
              label="로그인 실패"
              value={a?.login_failed ?? 0}
              cls={(a?.login_failed ?? 0) > 5 ? "text-amber-400" : "text-slate-300"}
              hint="24시간"
            />
          </div>

          {/* 데이터 이상 */}
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <div className="text-xs text-slate-400 mb-3">데이터 이상 감지</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <DataAnomalyRow
                label="6시간 초과 미체크아웃 세션"
                value={d?.long_running_sessions ?? 0}
                actionLabel="카운터 확인"
                actionHref="/counter"
                onClick={(href) => router.push(href)}
              />
              <DataAnomalyRow
                label="실장 미배정 active 세션"
                value={d?.sessions_without_manager ?? 0}
                actionLabel="카운터 확인"
                actionHref="/counter"
                onClick={(href) => router.push(href)}
              />
              <DataAnomalyRow
                label="방당 active 세션 중복"
                value={d?.duplicate_active_per_room ?? 0}
                actionLabel="카운터 확인"
                actionHref="/counter"
                onClick={(href) => router.push(href)}
              />
            </div>
          </div>

          {/* R-watchdog-v2: 운영 이상 — 회계/정산 누락 가시화 */}
          {ops && (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-xs text-slate-400">운영 이상 감지</div>
                <div className="text-[10px] text-slate-600">매일 1회 점검 권장</div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <DataAnomalyRow
                  label="마감 누락 영업일"
                  value={ops.unclosed_old_days}
                  actionLabel="마감 처리"
                  actionHref="/operating-days"
                  onClick={(href) => router.push(href)}
                />
                <DataAnomalyRow
                  label="24h 초과 draft 영수증"
                  value={ops.stale_draft_receipts}
                  actionLabel="정산 확정"
                  actionHref="/owner/settlement"
                  onClick={(href) => router.push(href)}
                />
                <DataAnomalyRow
                  label="30일 초과 미수금"
                  value={ops.old_unpaid_credits}
                  actionLabel="외상 회수"
                  actionHref="/credits"
                  onClick={(href) => router.push(href)}
                />
                <DataAnomalyRow
                  label="음수 재고"
                  value={ops.negative_stock}
                  actionLabel="재고 조정"
                  actionHref="/inventory"
                  onClick={(href) => router.push(href)}
                />
                <DataAnomalyRow
                  label="저재고 (min_stock 미만)"
                  value={ops.below_min_stock}
                  actionLabel="매입 등록"
                  actionHref="/finance/purchases"
                  onClick={(href) => router.push(href)}
                />
              </div>
            </div>
          )}

          {/* 에러 24시간 */}
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs text-slate-400">에러 (24시간)</div>
              <button
                onClick={() => router.push("/ops/errors")}
                className="text-[11px] text-cyan-400 hover:text-cyan-300"
              >상세 →</button>
            </div>
            <div className="text-2xl font-bold text-slate-200 mb-2">
              {data.errors.total_24h}
              <span className="text-xs text-slate-500 ml-1 font-normal">건</span>
            </div>
            {data.errors.by_tag.length > 0 && (
              <div className="flex flex-wrap gap-1.5 text-[10px]">
                {data.errors.by_tag.slice(0, 10).map(t => (
                  <span key={t.tag} className="px-2 py-0.5 rounded bg-white/[0.04] border border-white/10">
                    <code className="text-slate-400">{t.tag}</code>
                    <b className="ml-1 text-amber-300">{t.count}</b>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* 열린 이슈 */}
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs text-slate-400">열린 이슈 리포트</div>
              <button
                onClick={() => router.push("/ops/issues")}
                className="text-[11px] text-cyan-400 hover:text-cyan-300"
              >상세 →</button>
            </div>
            <div className="grid grid-cols-4 gap-2 text-center">
              <SeverityBadge label="심각" value={i?.critical ?? 0} cls="text-red-300 border-red-500/40 bg-red-500/10" />
              <SeverityBadge label="높음" value={i?.high ?? 0} cls="text-orange-300 border-orange-500/40 bg-orange-500/10" />
              <SeverityBadge label="중간" value={i?.medium ?? 0} cls="text-amber-300 border-amber-500/40 bg-amber-500/10" />
              <SeverityBadge label="낮음" value={i?.low ?? 0} cls="text-slate-300 border-slate-500/40 bg-slate-500/10" />
            </div>
          </div>

          {/* 감시봇 안내 */}
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-xs text-slate-400">
            <div className="font-semibold text-slate-300 mb-2">🤖 감시봇 동작 방식</div>
            <ul className="space-y-1 leading-relaxed">
              <li>• <b className="text-cyan-300">Vercel Cron</b> 이 5분마다 <code>ops-alerts-scan</code> 자동 실행 — 중복 세션, BLE 태그 불일치, 영업일 누락 검출</li>
              <li>• 이상 발견 시 <b className="text-cyan-300">Telegram</b> 으로 자동 알림 (in-memory dedup 으로 중복 발송 방지)</li>
              <li>• 외부 감시봇 5종 <code>monitoring/bots/*.mjs</code> 은 cron/systemd 환경에서 호출 (보안/DB 무결성/런타임/드리프트 점검)</li>
              <li>• 이 대시보드는 5분 주기 자동 새로고침</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}

function MetricCard({ label, value, cls, hint }: { label: string; value: number; cls: string; hint?: string }) {
  return (
    <div className="rounded-xl bg-white/[0.04] border border-white/[0.06] px-3 py-2">
      <div className="text-[10px] text-slate-500">{label}</div>
      <div className={`text-xl font-bold mt-0.5 ${cls}`}>{value}</div>
      {hint && <div className="text-[9px] text-slate-600">{hint}</div>}
    </div>
  )
}

function SeverityBadge({ label, value, cls }: { label: string; value: number; cls: string }) {
  return (
    <div className={`rounded-lg border py-2 ${cls}`}>
      <div className="text-[10px] opacity-70">{label}</div>
      <div className="text-xl font-bold mt-0.5">{value}</div>
    </div>
  )
}

function DataAnomalyRow({
  label, value, actionLabel, actionHref, onClick,
}: {
  label: string; value: number; actionLabel: string; actionHref: string; onClick: (href: string) => void
}) {
  const isIssue = value > 0
  return (
    <div className={`rounded-lg border px-3 py-2 ${
      isIssue ? "border-amber-500/30 bg-amber-500/5" : "border-white/[0.06] bg-white/[0.02]"
    }`}>
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className="flex items-center justify-between mt-1">
        <div className={`text-xl font-bold ${isIssue ? "text-amber-300" : "text-emerald-300"}`}>{value}</div>
        {isIssue && (
          <button
            onClick={() => onClick(actionHref)}
            className="text-[10px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-200 border border-amber-500/30"
          >{actionLabel}</button>
        )}
      </div>
    </div>
  )
}
