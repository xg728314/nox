"use client"

/**
 * FloorSummaryCard — super_admin 전용. 해당 층의 모든 매장 요약.
 * 실 API: GET /api/monitor/scope?scope=floor-N
 * BLE 없을 때도 재실/이탈 카운트는 participant 기반으로 정상 동작.
 */

import { useEffect, useState } from "react"
import { apiFetch } from "@/lib/apiFetch"

type StoreBrief = {
  store_uuid: string
  store_name: string
  floor_no: number | null
  summary: {
    present: number
    mid_out: number
    restroom: number
    external_floor: number
    waiting: number
  }
}

type Props = {
  floor: number
}

export default function FloorSummaryCard({ floor }: Props) {
  const [stores, setStores] = useState<StoreBrief[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true); setError(null); setStores([])
      try {
        const r = await apiFetch(`/api/monitor/scope?scope=floor-${floor}`)
        if (cancelled) return
        if (r.status === 403) {
          setError("super_admin 전용 뷰")
          return
        }
        if (!r.ok) {
          const b = await r.json().catch(() => ({}))
          setError(`${r.status} — ${b.message ?? b.error ?? "failed"}`)
          return
        }
        const json = await r.json() as { stores: StoreBrief[] }
        if (!cancelled) setStores(json.stores ?? [])
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "network error")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [floor])

  return (
    <section className="rounded-xl border border-cyan-500/20 bg-[#0b0e1c] p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[12px] font-bold text-cyan-200">{floor}층 요약 (super_admin)</div>
        {loading && <div className="text-[10px] text-slate-500">loading…</div>}
      </div>
      {error && (
        <div className="text-red-300 text-[11px] bg-red-500/10 border border-red-500/25 rounded px-2 py-1">⚠ {error}</div>
      )}
      {!loading && !error && stores.length === 0 && (
        <div className="text-slate-500 text-[11px] py-2">해당 층에 매장 없음.</div>
      )}
      {stores.length > 0 && (
        <table className="w-full text-[11px]">
          <thead><tr className="text-slate-500">
            <th className="text-left py-1">매장</th>
            <th className="text-right">재실</th>
            <th className="text-right">이탈</th>
            <th className="text-right">대기</th>
          </tr></thead>
          <tbody>
            {stores.map(s => (
              <tr key={s.store_uuid} className="border-t border-white/[0.06]">
                <td className="py-1 text-slate-200">{s.store_name}</td>
                <td className="text-right tabular-nums text-cyan-300">{s.summary.present}</td>
                <td className="text-right tabular-nums text-amber-300">{s.summary.mid_out}</td>
                <td className="text-right tabular-nums text-slate-300">{s.summary.waiting}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
