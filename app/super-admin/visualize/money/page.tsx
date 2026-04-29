"use client"

/**
 * /super-admin/visualize/money — Phase 1 sankey self-service.
 *
 * Operator picks store + business day. We poll the read-only API every
 * 30s and render a sankey of stored money flow values. No recalculation;
 * derived nodes (e.g. payout_pending) are clearly labelled.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import dynamic from "next/dynamic"
import Link from "next/link"
import { apiFetch } from "@/lib/apiFetch"
import AsOfBadge from "@/components/visualize/AsOfBadge"
import type { MoneyFlowResponse } from "@/lib/visualize/shapes"

const MoneyFlowSankey = dynamic(
  () => import("@/components/visualize/MoneyFlowSankey"),
  { ssr: false, loading: () => <div className="text-xs text-slate-400 p-4">로딩…</div> },
)

const POLL_MS = 30_000

type StoreCard = {
  store_uuid: string
  store_name: string
  store_code: string | null
  floor: number | null
  business_day_id: string | null
}

type FloorGroup = { floor: number | "unknown"; stores: StoreCard[] }

type DashboardData = {
  floors: FloorGroup[]
}

type OperatingDay = {
  id: string
  business_date: string
  status: string
  opened_at: string | null
  closed_at: string | null
}

function fmtWon(n: number): string {
  if (!Number.isFinite(n)) return "0원"
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(2)}억`
  if (n >= 10_000_000) return `${(n / 10_000_000).toFixed(1)}천만`
  if (n >= 10_000) return `${Math.floor(n / 10_000).toLocaleString()}만`
  return `${Math.round(n).toLocaleString()}원`
}

export default function VisualizeMoneyPage() {
  const router = useRouter()

  const [stores, setStores] = useState<StoreCard[]>([])
  const [storeUuid, setStoreUuid] = useState<string>("")
  const [days, setDays] = useState<OperatingDay[]>([])
  const [businessDayId, setBusinessDayId] = useState<string>("")
  const [data, setData] = useState<MoneyFlowResponse | null>(null)
  const [error, setError] = useState<string>("")
  const [loading, setLoading] = useState<boolean>(false)

  // ── Initial: load store list via existing super-admin dashboard ──────
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await apiFetch("/api/super-admin/dashboard", { cache: "no-store" })
        if (res.status === 401) { router.push("/login"); return }
        if (res.status === 403) { setError("권한이 없습니다 (super_admin 전용)."); return }
        if (!res.ok) { setError("매장 목록 로드 실패"); return }
        const body: DashboardData = await res.json()
        if (cancelled) return
        const flat: StoreCard[] = []
        for (const f of body.floors ?? []) {
          for (const s of f.stores ?? []) {
            flat.push({
              store_uuid: s.store_uuid,
              store_name: s.store_name,
              store_code: s.store_code ?? null,
              floor: typeof f.floor === "number" ? f.floor : null,
              business_day_id: s.business_day_id ?? null,
            })
          }
        }
        setStores(flat)
        if (flat.length > 0 && !storeUuid) setStoreUuid(flat[0].store_uuid)
      } catch {
        if (!cancelled) setError("매장 목록 로드 실패")
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── When store changes: fetch operating days ─────────────────────────
  useEffect(() => {
    if (!storeUuid) { setDays([]); return }
    let cancelled = false
    ;(async () => {
      try {
        const url = `/api/super-admin/visualize/operating-days?store_uuid=${storeUuid}`
        const res = await apiFetch(url, { cache: "no-store" })
        if (!res.ok) { setDays([]); setBusinessDayId(""); return }
        const body = await res.json()
        if (cancelled) return
        const list: OperatingDay[] = body.operating_days ?? []
        setDays(list)
        // Default selection: today (from dashboard) → else first item.
        const fromDashboard = stores.find((s) => s.store_uuid === storeUuid)?.business_day_id ?? null
        if (fromDashboard && list.some((d) => d.id === fromDashboard)) {
          setBusinessDayId(fromDashboard)
        } else if (list[0]) {
          setBusinessDayId(list[0].id)
        } else {
          setBusinessDayId("")
        }
      } catch {
        if (!cancelled) { setDays([]); setBusinessDayId("") }
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeUuid])

  // ── Money flow fetch + 30s polling ───────────────────────────────────
  const lastReqId = useRef(0)
  const fetchFlow = useCallback(async () => {
    if (!storeUuid || !businessDayId) { setData(null); return }
    const reqId = ++lastReqId.current
    setLoading(true)
    try {
      const url = `/api/super-admin/visualize/flow/money?store_uuid=${storeUuid}&business_day_id=${businessDayId}`
      const res = await apiFetch(url, { cache: "no-store" })
      if (reqId !== lastReqId.current) return // stale response
      if (res.status === 401) { router.push("/login"); return }
      if (res.status === 403) { setError("권한이 없습니다."); setData(null); return }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.message || `요청 실패 (${res.status})`)
        setData(null)
        return
      }
      const body: MoneyFlowResponse = await res.json()
      setData(body)
      setError("")
    } catch {
      setError("자금 흐름 로드 실패")
    } finally {
      if (reqId === lastReqId.current) setLoading(false)
    }
  }, [storeUuid, businessDayId, router])

  useEffect(() => {
    fetchFlow()
    if (!storeUuid || !businessDayId) return
    const t = window.setInterval(fetchFlow, POLL_MS)
    return () => window.clearInterval(t)
  }, [fetchFlow, storeUuid, businessDayId])

  const totals = data?.totals
  const selectedDay = useMemo(
    () => days.find((d) => d.id === businessDayId) ?? null,
    [days, businessDayId],
  )

  return (
    <main className="p-6 max-w-6xl mx-auto space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs text-slate-400">
            <Link href="/super-admin/visualize" className="hover:underline">관제 시각화</Link>
            <span className="mx-1">›</span>
            자금 흐름
          </div>
          <h1 className="text-xl font-semibold text-slate-100">자금 흐름 (stored sankey)</h1>
          <p className="text-[11px] text-slate-500 mt-0.5">
            DB 저장값만 사용. 정산/지급 로직 재계산 없음. payout_pending 은 (계산값) 으로 표시.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AsOfBadge asOf={data?.as_of ?? null} />
          {loading && <span className="text-[11px] text-slate-400">갱신 중…</span>}
        </div>
      </header>

      {/* Selectors */}
      <section className="flex flex-wrap items-end gap-3 rounded border border-slate-700 bg-slate-900 p-3">
        <div>
          <label className="text-[11px] text-slate-400 block mb-1">매장</label>
          <select
            value={storeUuid}
            onChange={(e) => setStoreUuid(e.target.value)}
            className="text-sm bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-100"
          >
            {stores.map((s) => (
              <option key={s.store_uuid} value={s.store_uuid}>
                {s.floor != null ? `${s.floor}F ` : ""}{s.store_name}
              </option>
            ))}
            {stores.length === 0 && <option value="">(매장 없음)</option>}
          </select>
        </div>
        <div>
          <label className="text-[11px] text-slate-400 block mb-1">영업일</label>
          <select
            value={businessDayId}
            onChange={(e) => setBusinessDayId(e.target.value)}
            className="text-sm bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-100"
          >
            {days.map((d) => (
              <option key={d.id} value={d.id}>
                {d.business_date} · {d.status === "open" ? "영업중" : "마감"}
              </option>
            ))}
            {days.length === 0 && <option value="">(영업일 없음)</option>}
          </select>
        </div>
        <button
          onClick={fetchFlow}
          className="text-xs px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-100"
        >
          새로고침
        </button>
      </section>

      {error && (
        <div className="rounded border border-rose-500/30 bg-rose-500/10 text-rose-300 text-sm p-3">
          {error}
        </div>
      )}

      {/* KPI strip — totals from API (stored values only) */}
      {totals && (
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Kpi label="영수증 총액" value={fmtWon(totals.receipts.gross_total)} sub={`${totals.receipts.count}건`} />
          <Kpi label="정산 합계" value={fmtWon(totals.settlements.total)} sub={`${totals.settlements.count}건`} />
          <Kpi label="지급 완료" value={fmtWon(totals.payouts.approved)} sub={`거부 ${fmtWon(totals.payouts.rejected)}`} />
          <Kpi label="외상 잔액" value={fmtWon(totals.credits_outstanding)} sub={`선정산 차감 ${fmtWon(totals.prepay_deduction)}`} />
        </section>
      )}

      {/* Sankey */}
      {data ? (
        <MoneyFlowSankey data={data} height={520} />
      ) : (
        <div className="rounded border border-dashed border-slate-700 p-6 text-center text-sm text-slate-400">
          {selectedDay ? "데이터 로딩 중…" : "매장과 영업일을 선택하세요."}
        </div>
      )}

      {/* Cross-store totals (sankey-out 외 in flow 별도 표시) */}
      {totals && (
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Kpi label="타매장 받을 돈 (대기)" value={fmtWon(totals.cross_store.in_pending)} />
          <Kpi label="타매장 받을 돈 (정산)" value={fmtWon(totals.cross_store.in_settled)} />
          <Kpi label="타매장 보낼 돈 (대기)" value={fmtWon(totals.cross_store.out_pending)} />
          <Kpi label="타매장 보낼 돈 (정산)" value={fmtWon(totals.cross_store.out_settled)} />
        </section>
      )}

      {/* Warnings */}
      {data && data.warnings.length > 0 && (
        <section className="rounded border border-amber-500/30 bg-amber-500/5 p-3">
          <div className="text-xs font-medium text-amber-300 mb-2">
            정합성 경고 ({data.warnings.length})
          </div>
          <ul className="space-y-1 text-[11px] text-amber-100/80">
            {data.warnings.map((w, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-amber-400 font-mono">{w.type}</span>
                <span className="flex-1">
                  {w.note}
                  {w.expected != null && w.actual != null && (
                    <span className="text-amber-400/70 ml-1">
                      (예상 {fmtWon(w.expected)} / 실제 {fmtWon(w.actual)})
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Source tables footer */}
      {data && (
        <footer className="text-[10px] text-slate-500 pt-2 border-t border-slate-800">
          source_tables: {data.source_tables.join(", ")}
        </footer>
      )}
    </main>
  )
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded border border-slate-700 bg-slate-900 p-3">
      <div className="text-[10px] text-slate-400">{label}</div>
      <div className="text-sm font-semibold text-slate-100 mt-0.5">{value}</div>
      {sub && <div className="text-[10px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  )
}
