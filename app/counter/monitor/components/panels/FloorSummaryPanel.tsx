"use client"

import type { MonitorRoom } from "../../types"

/**
 * FloorSummaryPanel — 층별 요약.
 *
 * Target visual: a compact table with floor column + per-store count
 * columns + total column. Cross-store aggregation would require data
 * beyond this endpoint (rule: do not leak other stores), so this round
 * renders a single "매장" column for the caller's store only. Structure,
 * spacing and header row match the target. When a future cross-store
 * overlay round lands, the extra columns attach without layout change.
 */

type Props = {
  rooms: MonitorRoom[]
  storeLabel?: string
}

const FLOORS = [5, 6, 7, 8] as const

export default function FloorSummaryPanel({ rooms, storeLabel = "매장" }: Props) {
  const byFloor = new Map<number, { active: number; total: number }>()
  for (const r of rooms) {
    const f = r.floor_no ?? 0
    const prev = byFloor.get(f) ?? { active: 0, total: 0 }
    prev.total += 1
    if (r.status === "active") prev.active += 1
    byFloor.set(f, prev)
  }
  const totalActive = Array.from(byFloor.values()).reduce((s, v) => s + v.active, 0)
  const totalRooms = Array.from(byFloor.values()).reduce((s, v) => s + v.total, 0)

  return (
    <div className="flex flex-col h-full">
      <div className="px-1 mb-2 flex items-center justify-between">
        <span className="text-[11px] text-slate-400 font-semibold">층별 요약</span>
        <span className="text-[10px] text-slate-600">타 매장 집계는 권한 외</span>
      </div>
      <div className="rounded-lg border border-white/[0.06] bg-white/[0.015] overflow-hidden">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="bg-white/[0.02]">
              <th className="px-2 py-1.5 text-left font-semibold text-slate-400 w-12">층</th>
              <th className="px-2 py-1.5 text-right font-semibold text-slate-400">{storeLabel}</th>
              <th className="px-2 py-1.5 text-right font-semibold text-slate-400 w-12">방</th>
              <th className="px-2 py-1.5 text-right font-semibold text-slate-400 w-12">계</th>
            </tr>
          </thead>
          <tbody>
            {FLOORS.map(f => {
              const s = byFloor.get(f) ?? { active: 0, total: 0 }
              return (
                <tr key={f} className="border-t border-white/[0.04]">
                  <td className="px-2 py-1 text-slate-300 font-semibold">{f}F</td>
                  <td className={`px-2 py-1 text-right tabular-nums ${s.active > 0 ? "text-emerald-300" : "text-slate-500"}`}>{s.active}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-slate-400">{s.total}</td>
                  <td className={`px-2 py-1 text-right tabular-nums font-semibold ${s.active > 0 ? "text-slate-100" : "text-slate-500"}`}>{s.active}</td>
                </tr>
              )
            })}
            <tr className="border-t border-white/10 bg-white/[0.02]">
              <td className="px-2 py-1 text-slate-200 font-bold">전체</td>
              <td className="px-2 py-1 text-right tabular-nums text-emerald-300 font-bold">{totalActive}</td>
              <td className="px-2 py-1 text-right tabular-nums text-slate-300">{totalRooms}</td>
              <td className="px-2 py-1 text-right tabular-nums text-slate-100 font-bold">{totalActive}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
