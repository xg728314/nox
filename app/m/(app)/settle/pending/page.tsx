"use client"
/**
 * /m/settle/pending — 미정산 이월 (payout_status != paid/held) hostess 목록.
 *
 * R-pending-split (2026-08-25): 사용자 요청 "미정산 은 따로 메뉴 · 오늘 정산은
 *   /m/settle 만". 정산 페이지가 오늘 정산 완료된 것 위주 · 이 페이지는 이월된
 *   미정산만 표시 · 클릭 시 정산 처리 (paid/held toggle).
 *
 * 실장별 그룹핑 · 카드 최소 형태 (담당 실장 · N명 · 매출) · 개별 hostess 카드 클릭
 * 시 정산 완료 toggle (같은 quickPayout API 사용).
 */
import { useMemo, useState } from "react"
import Link from "next/link"
import { PageHeader } from "../../../_components/PageHeader"
import { TabBar } from "../../../_components/TabBar"
import { useSettlement, useMe } from "../../../_hooks/useMobileData"
import { fmtMoneyWon } from "../../../_lib/format"
import { apiFetch } from "@/lib/apiFetch"
import { invalidateApi } from "../../../_hooks/useApi"
import { useToast, haptic } from "../../../_components/Toast"
import { cn } from "../../../_lib/cn"

export default function SettlePendingPage() {
  const settle = useSettlement()
  const me = useMe()
  const toast = useToast()
  const [quickBusy, setQuickBusy] = useState<string | null>(null)
  const [quickStatus, setQuickStatus] = useState<Map<string, "paid" | "held" | null>>(new Map())

  const summary = settle.data?.summary ?? []
  const withSettlement = summary.filter((r) => r.has_settlement)

  // 미정산 (paid/held 아님) · settlement 있는 것 만
  const pendingRows = useMemo(() => {
    return withSettlement.filter((r) => {
      const qs = quickStatus.get(r.hostess_id) ?? r.payout_status
      return qs !== "paid" && qs !== "held"
    })
  }, [withSettlement, quickStatus])

  const groupedByManager = useMemo(() => {
    type Group = { managerName: string; rows: typeof pendingRows }
    const map = new Map<string, Group>()
    for (const h of pendingRows) {
      const key = h.manager_membership_id ?? "__unassigned__"
      const managerName = h.manager_name ?? "미배정"
      if (!map.has(key)) map.set(key, { managerName, rows: [] })
      map.get(key)!.rows.push(h)
    }
    return [...map.entries()].sort((a, b) => {
      if (a[0] === "__unassigned__") return 1
      if (b[0] === "__unassigned__") return -1
      if (b[1].rows.length !== a[1].rows.length) return b[1].rows.length - a[1].rows.length
      return a[1].managerName.localeCompare(b[1].managerName, "ko")
    })
  }, [pendingRows])

  const totalGross = pendingRows.reduce((a, r) => a + (r.gross_total ?? 0), 0)

  async function quickPayout(hostessId: string, next: "paid" | "held") {
    if (quickBusy) return
    setQuickBusy(hostessId)
    haptic(10)
    try {
      // R-pending-endpoint-fix (2026-08-30): 잘못된 /api/manager/settlement/quick-payout
      //   (404) 대신 실 endpoint `/api/manager/staff-payout/[hostess_id]` PATCH 사용
      //   (settle/page.tsx quickPayout 과 동일 signature).
      const res = await apiFetch(`/api/manager/staff-payout/${encodeURIComponent(hostessId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j?.message ?? `HTTP ${res.status}`)
      }
      setQuickStatus((m) => new Map(m).set(hostessId, next))
      toast(next === "paid" ? "✓ 정산완료" : "📦 보관 처리", "success")
      invalidateApi("/api/manager/settlement/summary")
    } catch (e) {
      toast(`실패: ${(e as Error).message}`, "error")
    } finally {
      setQuickBusy(null)
    }
  }

  return (
    <div className="flex flex-col min-h-full">
      <PageHeader title="미정산 이월" backHref="/m/settle" subtitle={me.data?.store_name ?? ""} />

      <div className="px-4 pb-24">
        {/* 요약 배너 */}
        <div className="mb-3 rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3">
          <div className="text-[10px] font-extrabold uppercase tracking-widest text-amber-700">
            미정산 이월 총액
          </div>
          <div className="mt-0.5 text-[24px] font-extrabold tracking-tight text-amber-800">
            {fmtMoneyWon(totalGross)}
          </div>
          <div className="mt-1 text-[11px] font-bold text-amber-700/80">
            아가씨 {pendingRows.length}명 · 정산완료 or 보관 처리 후 여기서 사라짐
          </div>
        </div>

        {settle.isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-16 rounded-2xl bg-[#EFEBE3] animate-pulse" />
            ))}
          </div>
        )}
        {!settle.isLoading && pendingRows.length === 0 && (
          <div className="mt-6 rounded-2xl border border-dashed border-[#D8D2C8] bg-[#FAF5EC]/60 px-4 py-10 text-center">
            <div className="text-[12px] font-bold text-[#7A746A]">✓ 미정산 이월 없음</div>
            <div className="mt-1 text-[10px] text-[#7A746A]/70">모든 아가씨 정산 처리 완료</div>
            <Link
              href="/m/settle"
              className="mt-4 inline-block rounded-full bg-[#2D2B26] text-white text-[11px] font-bold px-4 py-2 no-underline"
            >
              정산 페이지로
            </Link>
          </div>
        )}

        {groupedByManager.map(([groupKey, group]) => {
          const groupGross = group.rows.reduce((a, r) => a + (r.gross_total ?? 0), 0)
          return (
            <div key={groupKey} className="mb-3">
              <div className="flex items-baseline justify-between mb-1.5 px-1">
                <div className="text-[12px] font-extrabold text-[#2D2B26]">
                  {group.managerName}
                  <span className="ml-1.5 text-[10px] font-bold text-[#7A746A]">
                    · 아가씨 {group.rows.length}명
                  </span>
                </div>
                <div className="text-[11px] font-extrabold text-amber-700">
                  {fmtMoneyWon(groupGross)}
                </div>
              </div>
              <div className="bg-white rounded-2xl overflow-hidden border border-[#D8D2C8]/60 divide-y divide-[#EFEBE3]">
                {group.rows.map((h) => {
                  const breakdown = h.store_breakdown ?? []
                  const breakdownText = breakdown.map((b) => `${b.store_name} ${b.count}`).join(" · ")
                  const gross = h.gross_total ?? 0
                  const busy = quickBusy === h.hostess_id
                  return (
                    <div key={h.hostess_id} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[13px] font-extrabold tracking-tight truncate">
                            {h.hostess_name}
                            <span className="ml-1.5 text-[10px] font-bold text-[#A87D45]">
                              {h.tc_count ?? 0}타임
                            </span>
                          </div>
                          {breakdownText && (
                            <div className="text-[10px] font-semibold text-[#7A746A] truncate mt-0.5">
                              {breakdownText}
                            </div>
                          )}
                        </div>
                        <div className="text-[14px] font-extrabold text-[#2D2B26] shrink-0 tabular-nums">
                          {fmtMoneyWon(gross)}
                        </div>
                      </div>
                      <div className="mt-2 flex gap-1.5">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => quickPayout(h.hostess_id, "paid")}
                          className={cn(
                            "flex-1 rounded-lg py-1.5 text-[11px] font-extrabold border-2 border-green-300 text-green-700 bg-white active:bg-green-50 disabled:opacity-40",
                          )}
                        >
                          {busy ? "..." : "✓ 정산완료"}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => quickPayout(h.hostess_id, "held")}
                          className={cn(
                            "flex-1 rounded-lg py-1.5 text-[11px] font-extrabold border-2 border-amber-300 text-amber-700 bg-white active:bg-amber-50 disabled:opacity-40",
                          )}
                        >
                          {busy ? "..." : "📦 보관"}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      <TabBar />
    </div>
  )
}
