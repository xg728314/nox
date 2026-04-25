"use client"

/**
 * 양주 손익분기 목표 현황.
 *
 * 2026-04-25: 월 고정비(월세+관리비+기타) 를 양주 매출로 얼마나 커버했는지,
 *   남은 기간 동안 몇 병/얼마를 더 팔아야 하는지 계산.
 *
 * 설정 소스: store_settings.monthly_rent / utilities / misc 또는 manual
 *   target_amount. 없으면 "운영비 설정이 비어있습니다" 안내.
 */

import { useEffect, useState } from "react"
import { apiFetch } from "@/lib/apiFetch"
import { fmtWon, fmtMan } from "@/lib/format"

type Target = {
  year: number
  month: number
  days_in_month: number
  days_elapsed: number
  days_remaining: number
  target: {
    amount: number
    mode: "auto" | "manual"
    fixed_costs: { rent: number; utilities: number; misc: number }
  }
  sold: {
    total_amount: number
    bottles_sold: number
    avg_price_per_bottle: number
  }
  gap: {
    remaining_amount: number
    per_day_amount: number
    per_day_bottles: number
    achieved_ratio: number
  }
  inventory_summary: Array<{
    name: string
    sold_count: number
    sold_amount: number
    cost_per_unit: number
    margin_per_unit: number
  }>
}

export default function LiquorTarget() {
  const [data, setData] = useState<Target | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [editOpen, setEditOpen] = useState(false)
  const [rent, setRent] = useState("")
  const [util, setUtil] = useState("")
  const [misc, setMisc] = useState("")
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true)
    setError("")
    try {
      const res = await apiFetch("/api/reports/liquor-target")
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.message || "조회 실패")
        return
      }
      const d = await res.json() as Target
      setData(d)
      setRent(String(d.target.fixed_costs.rent))
      setUtil(String(d.target.fixed_costs.utilities))
      setMisc(String(d.target.fixed_costs.misc))
    } catch {
      setError("네트워크 오류")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function saveSettings() {
    if (saving) return
    setSaving(true)
    try {
      const res = await apiFetch("/api/store/settings", {
        method: "PATCH",
        body: JSON.stringify({
          monthly_rent: Number(rent) || 0,
          monthly_utilities: Number(util) || 0,
          monthly_misc: Number(misc) || 0,
          liquor_target_mode: "auto",
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.message || "저장 실패")
        return
      }
      setEditOpen(false)
      await load()
    } catch {
      setError("네트워크 오류")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-center text-sm text-slate-500">
        목표 현황 로딩 중...
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
  if (!data) return null

  const targetEmpty = data.target.amount === 0
  const achievedPct = Math.round(data.gap.achieved_ratio * 100)

  return (
    <div className="space-y-3">
      {/* 목표 미설정 */}
      {targetEmpty && !editOpen && (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-200">
          <div className="flex items-center justify-between mb-1">
            <div className="font-semibold">운영비 설정이 비어있습니다</div>
            <button
              onClick={() => setEditOpen(true)}
              className="text-xs px-2.5 py-1 rounded-lg bg-amber-500/20 border border-amber-500/30 text-amber-100 font-medium"
            >
              설정하기
            </button>
          </div>
          <div className="text-xs text-amber-300/80 leading-relaxed">
            월세 · 관리비 · 기타 운영비를 입력하면 양주 매출 목표가 자동 계산됩니다.
          </div>
        </div>
      )}

      {/* 설정 편집 폼 */}
      {editOpen && (
        <div className="rounded-2xl border border-cyan-500/30 bg-cyan-500/5 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-cyan-200">운영비 설정 (월 고정비)</div>
            <button
              onClick={() => setEditOpen(false)}
              disabled={saving}
              className="text-slate-500 hover:text-slate-300 text-sm disabled:opacity-50"
            >✕</button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
            <label className="block">
              <span className="text-slate-400 block mb-1">월세 (원)</span>
              <input
                type="number"
                inputMode="numeric"
                value={rent}
                onChange={e => setRent(e.target.value)}
                disabled={saving}
                placeholder="예: 5000000"
                className="w-full bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="block">
              <span className="text-slate-400 block mb-1">관리비/공과금 (원)</span>
              <input
                type="number"
                inputMode="numeric"
                value={util}
                onChange={e => setUtil(e.target.value)}
                disabled={saving}
                placeholder="예: 1500000"
                className="w-full bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="block">
              <span className="text-slate-400 block mb-1">기타 고정비 (원)</span>
              <input
                type="number"
                inputMode="numeric"
                value={misc}
                onChange={e => setMisc(e.target.value)}
                disabled={saving}
                placeholder="예: 1000000"
                className="w-full bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
              />
            </label>
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => setEditOpen(false)}
              disabled={saving}
              className="flex-1 py-2 rounded-lg bg-white/[0.03] border border-white/10 text-slate-400 text-xs disabled:opacity-50"
            >취소</button>
            <button
              onClick={saveSettings}
              disabled={saving}
              className="flex-1 py-2 rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-cyan-200 text-xs font-semibold disabled:opacity-50"
            >{saving ? "저장 중..." : "저장"}</button>
          </div>
        </div>
      )}

      {/* 목표 vs 달성 */}
      {!targetEmpty && (
      <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4">
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="text-xs text-slate-400 flex items-center gap-2">
              <span>{data.year}년 {data.month}월 양주 매출 목표</span>
              {data.target.mode === "auto" && <span className="text-[10px] text-slate-500">(자동 · 고정비 기준)</span>}
              {data.target.mode === "manual" && <span className="text-[10px] text-slate-500">(수동 설정)</span>}
              {!editOpen && (
                <button
                  onClick={() => setEditOpen(true)}
                  className="text-[10px] text-cyan-400 hover:text-cyan-300 underline"
                >수정</button>
              )}
            </div>
            <div className="text-2xl font-bold text-emerald-300 mt-1">{fmtMan(data.target.amount)}</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-400">달성률</div>
            <div className={`text-2xl font-bold mt-1 ${
              achievedPct >= 100 ? "text-emerald-300" :
              achievedPct >= 50 ? "text-amber-300" : "text-red-400"
            }`}>
              {achievedPct}%
            </div>
          </div>
        </div>

        {/* progress bar */}
        <div className="h-3 rounded-full bg-white/[0.06] overflow-hidden mb-3">
          <div
            className={`h-full transition-all ${
              achievedPct >= 100 ? "bg-emerald-500" :
              achievedPct >= 50 ? "bg-amber-500" : "bg-red-500"
            }`}
            style={{ width: `${Math.min(100, achievedPct)}%` }}
          />
        </div>

        {/* 고정비 내역 (auto 모드) */}
        {data.target.mode === "auto" && (
          <div className="grid grid-cols-3 gap-2 text-[11px] text-slate-400 mb-2">
            <div className="flex justify-between bg-white/[0.03] px-2 py-1 rounded">
              <span>월세</span>
              <span className="text-slate-300">{fmtMan(data.target.fixed_costs.rent)}</span>
            </div>
            <div className="flex justify-between bg-white/[0.03] px-2 py-1 rounded">
              <span>관리비</span>
              <span className="text-slate-300">{fmtMan(data.target.fixed_costs.utilities)}</span>
            </div>
            <div className="flex justify-between bg-white/[0.03] px-2 py-1 rounded">
              <span>기타</span>
              <span className="text-slate-300">{fmtMan(data.target.fixed_costs.misc)}</span>
            </div>
          </div>
        )}
      </div>
      )}

      {/* 현재까지 판매 */}
      <div className="grid grid-cols-3 gap-2">
        <StatCard label="판매 매출" value={fmtMan(data.sold.total_amount)} cls="text-cyan-300" />
        <StatCard label="판매 병수" value={`${data.sold.bottles_sold}병`} cls="text-cyan-300" />
        <StatCard label="평균 병당" value={fmtWon(data.sold.avg_price_per_bottle)} cls="text-slate-200" />
      </div>

      {/* 남은 기간 필요 매출 */}
      {!targetEmpty && data.gap.remaining_amount > 0 && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
          <div className="text-xs text-amber-300/80 mb-1">
            남은 {data.days_remaining}일 동안 필요한 매출
          </div>
          <div className="text-xl font-bold text-amber-300">
            {fmtMan(data.gap.remaining_amount)}
          </div>
          {data.days_remaining > 0 && (
            <div className="mt-3 pt-3 border-t border-amber-500/20 grid grid-cols-2 gap-3 text-xs">
              <div>
                <div className="text-slate-400">일일 매출 목표</div>
                <div className="text-lg font-bold text-amber-200 mt-0.5">{fmtMan(data.gap.per_day_amount)}</div>
              </div>
              <div>
                <div className="text-slate-400">일일 판매 병수</div>
                <div className="text-lg font-bold text-amber-200 mt-0.5">
                  {data.gap.per_day_bottles > 0 ? `${data.gap.per_day_bottles}병` : "—"}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {!targetEmpty && data.gap.remaining_amount === 0 && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200 font-semibold text-center">
          🎉 이번 달 양주 매출 목표 달성!
        </div>
      )}

      {/* 품목별 */}
      {data.inventory_summary.length > 0 && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
          <div className="text-xs text-slate-400 mb-2">품목별 판매 Top</div>
          <div className="space-y-1 text-[11px]">
            <div className="grid grid-cols-[1fr_60px_90px_90px] gap-2 text-[10px] text-slate-500 px-2">
              <span>품목</span>
              <span className="text-right">병수</span>
              <span className="text-right">매출</span>
              <span className="text-right">병당 마진</span>
            </div>
            {data.inventory_summary.map((it, i) => (
              <div key={`${it.name}-${i}`} className="grid grid-cols-[1fr_60px_90px_90px] gap-2 px-2 py-1 hover:bg-white/[0.03] rounded">
                <span className="text-slate-200 truncate">{it.name}</span>
                <span className="text-right text-slate-400">{it.sold_count}</span>
                <span className="text-right text-amber-300">{fmtMan(it.sold_amount)}</span>
                <span className="text-right text-emerald-300">{fmtMan(it.margin_per_unit)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, cls }: { label: string; value: string; cls: string }) {
  return (
    <div className="rounded-xl bg-white/[0.04] border border-white/[0.06] px-3 py-2">
      <div className="text-[10px] text-slate-500">{label}</div>
      <div className={`text-base font-bold mt-0.5 ${cls}`}>{value}</div>
    </div>
  )
}
