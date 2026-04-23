"use client"

import { useEffect, useRef, useState } from "react"
import { apiFetch } from "@/lib/apiFetch"

/**
 * /ops/attendance — ROUND-OPS-1 운영 모니터링 대시보드.
 *
 * 읽기 전용. 10초 간격 polling. 기존 출근/정산/권한 로직과 무관.
 * middleware 의 /ops OWNER_ONLY 게이트로 보호됨.
 */

type Overview = {
  store_uuid: string
  business_day_id: string | null
  attendance: { total: number; checked_in: number; checked_out: number }
  ble: { live_count: number; auto_checkin_count: number }
  anomalies: {
    duplicate_open: number
    recent_checkout_block: number
    tag_mismatch: number
    no_business_day: number
  }
  sample: {
    duplicate_membership_ids: string[]
    mismatch_membership_ids: string[]
    no_tag_membership_ids: string[]
    recent_checkout_block_ids?: string[]
    no_business_day_ids?: string[]
  }
  generated_at: string
  window_min: number
}

type NameMap = Record<string, string>

const POLL_MS = 10_000

export default function AttendanceOverviewPage() {
  const [data, setData] = useState<Overview | null>(null)
  const [names, setNames] = useState<NameMap>({})
  const [error, setError] = useState<string>("")
  const [loading, setLoading] = useState(true)
  const [lastAt, setLastAt] = useState<string>("")
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  async function fetchOnce() {
    try {
      const res = await apiFetch("/api/ops/attendance-overview")
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body?.message || body?.error || "조회 실패")
        return
      }
      const j = (await res.json()) as Overview
      setData(j)
      setLastAt(new Date().toLocaleTimeString("ko-KR"))
      setError("")
      // 이상 id 들의 이름 해석
      const ids = new Set<string>([
        ...j.sample.duplicate_membership_ids,
        ...j.sample.mismatch_membership_ids,
        ...(j.sample.recent_checkout_block_ids ?? []),
        ...(j.sample.no_business_day_ids ?? []),
      ])
      const missing = [...ids].filter((id) => !(id in names))
      if (missing.length > 0) {
        // /api/store/staff 로 일괄 이름 해석 시도 (이미 scoped)
        try {
          const r2 = await apiFetch("/api/store/staff?role=hostess")
          if (r2.ok) {
            const d = await r2.json()
            const add: NameMap = {}
            type S = { membership_id: string; name: string }
            for (const s of (d?.staff ?? []) as S[]) {
              add[s.membership_id] = s.name
            }
            setNames((prev) => ({ ...prev, ...add }))
          }
        } catch { /* ignore */ }
      }
    } catch {
      setError("네트워크 오류")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchOnce()
    pollRef.current = setInterval(fetchOnce, POLL_MS)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── render helpers ──────────────────────────────────────
  const short = (id: string) => id.slice(0, 8)
  const nameOf = (id: string) => names[id] || short(id)

  const anomaliesTotal =
    (data?.anomalies.duplicate_open ?? 0) +
    (data?.anomalies.recent_checkout_block ?? 0) +
    (data?.anomalies.tag_mismatch ?? 0) +
    (data?.anomalies.no_business_day ?? 0)

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">출근 · BLE 모니터링</h1>
            <p className="text-sm text-slate-400 mt-1">
              실시간 운영 대시보드 · 10초 간격 갱신 · 읽기 전용
            </p>
          </div>
          <div className="text-xs text-slate-500">
            {lastAt && <>최근 갱신: <span className="text-slate-300">{lastAt}</span></>}
            {loading && <span className="ml-2 text-slate-400">로딩...</span>}
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {data && (
          <>
            {/* Business day banner */}
            {!data.business_day_id && (
              <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
                ⚠ 오늘 영업일(business_day)이 열려있지 않습니다. 출근 기록이 저장되지 않습니다.
              </div>
            )}

            {/* Summary cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
              <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
                <div className="text-xs text-slate-400">현재 출근 인원</div>
                <div className="mt-1 font-mono text-2xl text-emerald-300">
                  {data.attendance.checked_in}
                </div>
                <div className="mt-0.5 text-[11px] text-slate-500">
                  전체 {data.attendance.total}건 · 퇴근 {data.attendance.checked_out}건
                </div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
                <div className="text-xs text-slate-400">
                  BLE 감지 인원 (최근 {data.window_min}분)
                </div>
                <div className="mt-1 font-mono text-2xl text-sky-300">
                  {data.ble.live_count}
                </div>
                <div className="mt-0.5 text-[11px] text-slate-500">
                  ble_presence_history 기준
                </div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
                <div className="text-xs text-slate-400">BLE 자동 출근 (오늘)</div>
                <div className="mt-1 font-mono text-2xl text-slate-100">
                  {data.ble.auto_checkin_count}
                </div>
                <div className="mt-0.5 text-[11px] text-slate-500">
                  notes = &quot;source:ble&quot;
                </div>
              </div>
            </div>

            {/* Anomaly status banner */}
            <div
              className={
                "mb-4 rounded-lg border p-3 text-sm " +
                (anomaliesTotal === 0
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                  : "border-red-500/30 bg-red-500/10 text-red-200")
              }
            >
              {anomaliesTotal === 0 ? (
                <>✓ 정상 · 감지된 이상 없음</>
              ) : (
                <>⚠ 이상 {anomaliesTotal}건 감지 — 아래 섹션에서 확인</>
              )}
            </div>

            {/* Anomaly counters */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <AnomalyCard
                label="중복 출근"
                count={data.anomalies.duplicate_open}
                severity="danger"
              />
              <AnomalyCard
                label="재출근 차단"
                count={data.anomalies.recent_checkout_block}
                severity="warn"
              />
              <AnomalyCard
                label="Tag 미매칭"
                count={data.anomalies.tag_mismatch}
                severity="warn"
              />
              <AnomalyCard
                label="영업일 누락"
                count={data.anomalies.no_business_day}
                severity="danger"
              />
            </div>

            {/* Sample lists */}
            <div className="space-y-4">
              <AnomalyList
                title="중복 출근 (checked_out_at IS NULL 중복)"
                severity="danger"
                ids={data.sample.duplicate_membership_ids}
                nameOf={nameOf}
              />
              <AnomalyList
                title="Tag 미매칭 (BLE 감지 but ble_tags 없음)"
                severity="warn"
                ids={data.sample.mismatch_membership_ids}
                nameOf={nameOf}
              />
              <AnomalyList
                title="최근 1시간 checkout 후 BLE 재감지 (자동 재출근 차단됨)"
                severity="warn"
                ids={data.sample.recent_checkout_block_ids ?? []}
                nameOf={nameOf}
              />
              <AnomalyList
                title="영업일 없음 (BLE 감지 but open business_day 없음)"
                severity="danger"
                ids={data.sample.no_business_day_ids ?? []}
                nameOf={nameOf}
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── components ────────────────────────────────────────────

function AnomalyCard({
  label,
  count,
  severity,
}: {
  label: string
  count: number
  severity: "warn" | "danger"
}) {
  const normal = count === 0
  const cls = normal
    ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-300"
    : severity === "danger"
    ? "border-red-500/30 bg-red-500/10 text-red-300"
    : "border-amber-500/30 bg-amber-500/10 text-amber-300"
  return (
    <div className={`rounded-lg border p-3 ${cls}`}>
      <div className="text-[11px] opacity-80">{label}</div>
      <div className="mt-1 font-mono text-xl">{count}</div>
    </div>
  )
}

function AnomalyList({
  title,
  severity,
  ids,
  nameOf,
}: {
  title: string
  severity: "warn" | "danger"
  ids: string[]
  nameOf: (id: string) => string
}) {
  if (ids.length === 0) return null
  const headerCls =
    severity === "danger" ? "text-red-300" : "text-amber-300"
  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <h2 className={`text-sm font-semibold mb-2 ${headerCls}`}>
        {title} · <span className="text-slate-400 font-normal">{ids.length}건</span>
      </h2>
      <ul className="divide-y divide-slate-800 text-sm">
        {ids.map((id) => (
          <li key={id} className="py-1.5 flex items-center gap-3">
            <span className="text-slate-100">{nameOf(id)}</span>
            <span className="text-[11px] text-slate-500 font-mono">{id.slice(0, 8)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
