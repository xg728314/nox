"use client"

/**
 * 총매출 세부 내역 (방별 + 주문 타입별).
 *
 * 2026-04-25: /reports 의 "총 매출" 카드 클릭 시 펼쳐지는 세부. 스태프/실장
 *   개별 지급액은 비노출 (CLAUDE.md L140-142 owner 가시성 룰 준수). 방별
 *   타임/주문 breakdown 만 표시.
 */

import { useEffect, useState } from "react"
import { apiFetch } from "@/lib/apiFetch"
import { fmtWon } from "@/lib/format"

type OrderBucket = { count: number; amount: number }
type RoomRow = {
  room_uuid: string
  room_name: string
  session_id: string
  started_at: string
  ended_at: string | null
  customer_name: string | null
  status: string
  time_total: number
  order_total: number
  order_breakdown: {
    liquor: OrderBucket
    tip: OrderBucket
    room_ti: OrderBucket
    purchase: OrderBucket
    other: OrderBucket
  }
  gross_total: number
}

type Breakdown = {
  business_date: string
  rooms: RoomRow[]
  type_totals: {
    time_total: number
    liquor_total: number
    tip_total: number
    room_ti_total: number
    purchase_total: number
    other_total: number
    gross_total: number
  }
}

export default function RevenueBreakdown({
  businessDayId,
  open,
}: {
  businessDayId: string | null
  open: boolean
}) {
  const [data, setData] = useState<Breakdown | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!open || !businessDayId) return
    let cancelled = false
    async function load() {
      setLoading(true)
      setError("")
      try {
        const res = await apiFetch(`/api/reports/daily/breakdown?business_day_id=${businessDayId}`)
        if (!res.ok) {
          const d = await res.json().catch(() => ({}))
          if (!cancelled) setError(d.message || "세부 내역 조회 실패")
          return
        }
        if (!cancelled) setData(await res.json())
      } catch {
        if (!cancelled) setError("네트워크 오류")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [open, businessDayId])

  if (!open) return null

  if (loading) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-center text-sm text-slate-500">
        세부 내역 로딩 중...
      </div>
    )
  }
  if (error) {
    return (
      <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-400">
        {error}
      </div>
    )
  }
  if (!data || data.rooms.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-center text-sm text-slate-500">
        이 날짜에 세션이 없습니다.
      </div>
    )
  }

  const t = data.type_totals

  return (
    <div className="space-y-3">
      {/* 타입별 총계 */}
      <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4">
        <div className="text-xs text-slate-400 mb-2">매출 구성 (스태프 개별 지급액 제외)</div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
          <BreakdownRow label="스태프 타임" value={t.time_total} cls="text-cyan-300" />
          <BreakdownRow label="양주" value={t.liquor_total} cls="text-amber-300" />
          <BreakdownRow label="룸티" value={t.room_ti_total} cls="text-purple-300" />
          <BreakdownRow label="팁" value={t.tip_total} cls="text-pink-300" />
          <BreakdownRow label="사입" value={t.purchase_total} cls="text-rose-300" />
          <BreakdownRow label="기타" value={t.other_total} cls="text-slate-300" />
        </div>
        <div className="mt-3 pt-3 border-t border-white/10 flex justify-between">
          <span className="text-xs text-slate-400">총 매출</span>
          <span className="text-base font-bold text-emerald-300">{fmtWon(t.gross_total)}</span>
        </div>
      </div>

      {/* 방별 세부 */}
      <div className="space-y-2">
        {data.rooms.map(r => (
          <RoomBreakdownCard key={r.session_id} row={r} />
        ))}
      </div>
    </div>
  )
}

function BreakdownRow({ label, value, cls }: { label: string; value: number; cls: string }) {
  return (
    <div className="flex items-center justify-between px-2 py-1.5 rounded bg-white/[0.02] border border-white/[0.04]">
      <span className="text-slate-400">{label}</span>
      <span className={`font-semibold ${cls}`}>{fmtWon(value)}</span>
    </div>
  )
}

function RoomBreakdownCard({ row }: { row: RoomRow }) {
  const ob = row.order_breakdown
  const hasOrders =
    ob.liquor.count + ob.tip.count + ob.room_ti.count + ob.purchase.count + ob.other.count > 0

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-slate-200">{row.room_name}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${
            row.status === "active"
              ? "bg-red-500/20 text-red-300"
              : "bg-slate-500/20 text-slate-400"
          }`}>
            {row.status === "active" ? "진행" : "종료"}
          </span>
          {row.customer_name && (
            <span className="text-[11px] text-cyan-300">{row.customer_name}</span>
          )}
        </div>
        <span className="text-sm font-bold text-emerald-300">{fmtWon(row.gross_total)}</span>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
        <div className="flex justify-between">
          <span className="text-slate-500">스태프 타임</span>
          <span className="text-cyan-300 font-medium">{fmtWon(row.time_total)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">주문 소계</span>
          <span className="text-amber-300 font-medium">{fmtWon(row.order_total)}</span>
        </div>
      </div>

      {hasOrders && (
        <div className="mt-2 pt-2 border-t border-white/[0.06] text-[10px] text-slate-400">
          {ob.liquor.count > 0 && (
            <div className="flex justify-between"><span>  └ 양주 {ob.liquor.count}병</span><span>{fmtWon(ob.liquor.amount)}</span></div>
          )}
          {ob.room_ti.count > 0 && (
            <div className="flex justify-between"><span>  └ 룸티 {ob.room_ti.count}</span><span>{fmtWon(ob.room_ti.amount)}</span></div>
          )}
          {ob.tip.count > 0 && (
            <div className="flex justify-between"><span>  └ 팁 {ob.tip.count}</span><span>{fmtWon(ob.tip.amount)}</span></div>
          )}
          {ob.purchase.count > 0 && (
            <div className="flex justify-between"><span>  └ 사입 {ob.purchase.count}</span><span>{fmtWon(ob.purchase.amount)}</span></div>
          )}
          {ob.other.count > 0 && (
            <div className="flex justify-between"><span>  └ 기타 {ob.other.count}</span><span>{fmtWon(ob.other.amount)}</span></div>
          )}
        </div>
      )}
    </div>
  )
}
