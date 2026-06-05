"use client"
import Link from "next/link"
import { useState } from "react"
import { PageHeader } from "../../_components/PageHeader"
import { TabBar } from "../../_components/TabBar"
import { useSettlement, useMe } from "../../_hooks/useMobileData"
import { fmtMoney, fmtMoneyWon } from "../../_lib/format"
import { cn } from "../../_lib/cn"

type Period = "today" | "week"

export default function SettlePage() {
  const me = useMe()
  const settle = useSettlement()
  const [period, setPeriod] = useState<Period>("today")

  const total = settle.data?.total_gross ?? 0
  const count = settle.data?.total_count ?? 0
  const byHostess = settle.data?.by_hostess ?? []

  return (
    <div className="flex flex-col min-h-full">
      <PageHeader
        title="정산"
        subtitle={`${me.data?.full_name ?? ""} · ${me.data?.store_name ?? ""}`}
        backHref="/m"
      />

      <div className="px-5 pb-24">
        {/* 기간 탭 (오늘 / 이번 주만) */}
        <div className="flex bg-[#EFEBE3] rounded-2xl p-1 mb-4">
          {(["today", "week"] as Period[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={cn(
                "flex-1 py-2.5 text-[12px] font-extrabold rounded-xl transition-colors",
                period === p ? "bg-white text-[#2D2B26] shadow-sm" : "text-[#7A746A]",
              )}
            >
              {p === "today" ? "오늘" : "이번 주"}
            </button>
          ))}
        </div>

        {/* 총액 카드 */}
        <div className="bg-gradient-to-br from-white/95 to-[#F0E8D8] rounded-3xl p-6 mb-4 shadow-md relative overflow-hidden">
          <div className="text-[10px] font-bold text-[#C49B61] uppercase tracking-widest">
            {period === "today" ? "오늘 스태프 매출" : "이번 주 스태프 매출"}
          </div>
          <div className="flex items-baseline gap-1 mt-1.5">
            <span className="text-[42px] font-extrabold leading-none tracking-tighter bg-gradient-to-br from-[#2D2B26] to-[#A87D45] bg-clip-text text-transparent">
              {fmtMoney(total, { unit: false })}
            </span>
            <span className="text-[16px] font-bold text-[#7A746A]">만원</span>
          </div>
          <div className="grid grid-cols-3 gap-1.5 mt-4 pt-3 border-t border-[#D8D2C8]/50">
            <Stat v={count} l="메이드" />
            <Stat v={byHostess.length} l="스태프" />
            <Stat v={me.data?.store_floor ?? "—"} l="층" />
          </div>
        </div>

        {/* 내 장부 — 어제 / 이번 주 */}
        <div className="bg-gradient-to-br from-[#2D2B26] to-[#1a1813] rounded-3xl p-5 mb-4 text-white shadow-lg relative overflow-hidden">
          <div className="absolute -top-10 -right-10 w-36 h-36 bg-[#C49B61]/25 rounded-full blur-2xl pointer-events-none" />
          <div className="relative">
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[10px] font-extrabold text-[#E4C99A] uppercase tracking-widest">📒 내 장부</div>
              <div className="text-[9px] font-bold text-white/50">실장 본인 순수익</div>
            </div>
            <div className="flex items-baseline gap-1 mb-4">
              <span className="text-[38px] font-extrabold tracking-tighter text-[#E4C99A]">+34</span>
              <span className="text-[16px] text-white/70 font-bold">만원</span>
            </div>
            <div className="grid grid-cols-2 gap-2 pt-3 border-t border-white/15">
              <Card v="+29만" l="어제" />
              <Card v="+280만" l="이번 주" />
            </div>
          </div>
        </div>

        {/* 스태프별 */}
        <div className="flex items-center justify-between mb-2">
          <div className="text-[13px] font-extrabold">스태프별</div>
          <Link href="/m/staff" className="text-[11px] font-bold text-[#A87D45] no-underline">
            전체 →
          </Link>
        </div>

        {settle.isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-16 rounded-2xl bg-[#EFEBE3] animate-pulse" />
            ))}
          </div>
        )}
        {settle.error && <div className="text-red-600 text-[12px] text-center font-semibold py-4">정산을 불러올 수 없습니다</div>}
        {!settle.isLoading && byHostess.length === 0 && (
          <div className="text-[12px] text-[#7A746A] text-center font-semibold py-8">정산할 메이드 기록이 없습니다</div>
        )}
        {byHostess.length > 0 && (
          <div className="bg-white rounded-2xl overflow-hidden border border-[#D8D2C8]/60">
            {byHostess.map((h, i) => (
              <div
                key={h.hostess_id}
                className={cn(
                  "flex items-center gap-3 px-4 py-3",
                  i > 0 && "border-t border-[#D8D2C8]/40",
                )}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-extrabold tracking-tight">{h.hostess_name}</div>
                  <div className="text-[10px] font-semibold text-[#7A746A]">{h.count}건 메이드</div>
                </div>
                <div className="text-right">
                  <div className="text-[14px] font-extrabold tracking-tight">{fmtMoneyWon(h.gross)}</div>
                  <div className="text-[9px] font-semibold text-[#A87D45]">지급 {fmtMoney(h.payout)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <TabBar />
    </div>
  )
}

function Stat({ v, l }: { v: string | number; l: string }) {
  return (
    <div className="text-center">
      <div className="text-[15px] font-extrabold tracking-tight">{v}</div>
      <div className="text-[9px] font-semibold text-[#7A746A] mt-0.5">{l}</div>
    </div>
  )
}
function Card({ v, l }: { v: string; l: string }) {
  return (
    <div className="text-center">
      <div className="text-[18px] font-extrabold tracking-tight text-[#E4C99A]">{v}</div>
      <div className="text-[9px] font-bold text-white/50 uppercase tracking-wider mt-0.5">{l}</div>
    </div>
  )
}
