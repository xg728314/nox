"use client"
import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { PageHeader } from "../../_components/PageHeader"
import { TabBar } from "../../_components/TabBar"
import { Sheet } from "../../_components/Sheet"
import { useToast, haptic } from "../../_components/Toast"
import { useSettlement, useMe, useIncomingStaff, type IncomingStaffGroup, type IncomingStaffParticipant } from "../../_hooks/useMobileData"
import { fmtMoney, fmtMoneyWon, fmtRelative } from "../../_lib/format"
import { cn } from "../../_lib/cn"
import { apiFetch } from "@/lib/apiFetch"
import { invalidateApi } from "../../_hooks/useApi"
import { EditParticipantSheet } from "../../_components/EditParticipantSheet"
import { StaffPayoutSheet } from "../../_components/StaffPayoutSheet"
import { StaffDetailSheet } from "../../_components/StaffDetailSheet"
import { TrendChart } from "../../_components/TrendChart"
import { AiSummaryButton } from "../../_components/AiSummaryButton"

type Period = "today" | "week"

const RESET_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7일

function resetKey(membershipId: string | null | undefined) {
  return membershipId ? `m.settle.reset.${membershipId}` : null
}

export default function SettlePage() {
  const me = useMe()
  const settle = useSettlement()
  const incoming = useIncomingStaff()
  const toast = useToast()
  const [period, setPeriod] = useState<Period>("today")
  const [resetSheetOpen, setResetSheetOpen] = useState(false)
  const [password, setPassword] = useState("")
  const [verifying, setVerifying] = useState(false)
  const [resetAt, setResetAt] = useState<Date | null>(null)
  // R-staff-payout (2026-06-26): 팁/메모용 기존 시트 (💸 버튼 전용)
  const [payoutTarget, setPayoutTarget] = useState<{ id: string; name: string } | null>(null)
  // R-staff-detail (2026-07-19): 이름 클릭 → 세부 정산 (세션별, 종목별, 시간당 공제)
  const [detailTarget, setDetailTarget] = useState<{ id: string; name: string } | null>(null)
  // R-inline-expand (2026-08-23): 스태프별 카드 이름 클릭 시 인라인 accordion
  //   기존: setDetailTarget → 별도 시트 (한 화면 더). 사용자 요구 심플화.
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const toggleExpand = (id: string) => {
    setExpandedRows((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }
  // R-quick-payout (2026-06-26): row 우측 [✓완료] [📦보관] 빠른 액션
  //   - 누르면 즉시 PATCH 호출, 시트 안 띄움.
  //   - 로컬 state 로 처리 표시 (서버 응답 후 invalidate).
  const [quickBusy, setQuickBusy] = useState<string | null>(null)
  const [quickStatus, setQuickStatus] = useState<Map<string, "paid" | "held">>(new Map())

  async function quickPayout(hostessId: string, status: "paid" | "held") {
    if (quickBusy) return
    setQuickBusy(hostessId)
    haptic([10, 20, 10])
    try {
      const res = await apiFetch(`/api/manager/staff-payout/${encodeURIComponent(hostessId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j?.message ?? `HTTP ${res.status}`)
      }
      setQuickStatus((m) => { const n = new Map(m); n.set(hostessId, status); return n })
      toast(status === "paid" ? "✓ 정산완료" : "📦 보관 처리", "success")
      invalidateApi("/api/manager/settlement/summary")
    } catch (e) {
      toast(`처리 실패: ${(e as Error).message}`, "error")
    } finally {
      setQuickBusy(null)
    }
  }

  // localStorage 에서 초기화 시각 로드 + 만료 (7일) 자동 정리
  useEffect(() => {
    const key = resetKey(me.data?.membership_id)
    if (!key || typeof window === "undefined") return
    const v = window.localStorage.getItem(key)
    if (!v) {
      setResetAt(null)
      return
    }
    const d = new Date(v)
    if (Number.isNaN(d.getTime()) || Date.now() - d.getTime() > RESET_TTL_MS) {
      window.localStorage.removeItem(key)
      setResetAt(null)
      return
    }
    setResetAt(d)
  }, [me.data?.membership_id])

  const isReset = resetAt !== null

  // 초기화 상태에서는 화면상 0 으로 표시 (실 데이터는 서버에 보존)
  // 2026-06-24 R-settle-shape-fix: API 는 summary[] 반환 — 합계는 client 집계.
  const summary = isReset ? [] : settle.data?.summary ?? []
  const withSettlement = summary.filter((r) => r.has_settlement)
  const total = isReset ? 0 : withSettlement.reduce((a, r) => a + (r.gross_total ?? 0), 0)
  const count = isReset ? 0 : withSettlement.reduce((a, r) => a + (r.tc_count ?? 0), 0)
  const byHostess = withSettlement

  // R-settle-myprofit-fix (2026-06-28): "내 장부" 계산 사용자 의도와 맞춤.
  //   사용자 의도: 매출 - 정산완료된 식구 지급액 = 실장 순수익.
  //   예: 매출 1650만 - 정산완료 식구 지급 1500만 = 150만 (실장 차익 / 미지급 보관 포함).
  //   정산완료 토글 누른 식구만 '식구 지급'에 합산 — 미지급 식구 금액은 실장 손에 있음.
  // R-store-totals (2026-08-23): 서버 store_totals 우선 사용 (owner 마스킹 우회).
  //   owner 응답에서 개별 hostess_amount 는 null 로 masked 되지만 · 매장 총액은
  //   store_totals 로 unmasked 노출됨 → dashboard "식구 지급 —" 문제 해결.
  //   store_totals 없으면 (구 API 응답) 기존 client sum 방식 fallback.
  const storeTotals = settle.data?.store_totals
  const totalGross = isReset
    ? 0
    : storeTotals?.total_gross ?? withSettlement.reduce((a, r) => a + (r.gross_total ?? 0), 0)
  const settledHostessPayout = isReset
    ? 0
    : storeTotals?.total_hostess_payout ?? withSettlement
        .filter((r) => r.payout_status === "paid" || r.payout_status === "held")
        .reduce((a, r) => a + (r.hostess_amount ?? 0), 0)
  const totalHostessPayout = settledHostessPayout
  const myProfit = isReset ? 0 : Math.max(0, totalGross - settledHostessPayout)
  const totalManagerJjing = isReset
    ? 0
    : storeTotals?.total_manager_jjing ?? withSettlement.reduce((a, r) => a + (r.manager_amount ?? 0), 0)

  // R-payout-hide-3h (2026-06-27): 정산완료 후 3시간 지난 row 는 목록에서 hide.
  //   사용자 요구: "하루 지났는데 목록에 뜨면 더 햇갈린다".
  //   paid_at + 3h < now 면 filter out. held / pending 은 그대로 표시.
  const visibleByHostess = useMemo(() => {
    // R-pending-split (2026-08-25): 사용자 요구 "미정산은 별도 메뉴 · 오늘만 정산 페이지".
    //   payout_status=paid/held 만 노출 · 미처리 (null/pending) 는 pending 페이지에서.
    //   기존 3h auto-hide (paid) 는 유지 · held 는 항상 표시.
    const cutoff = Date.now() - 3 * 60 * 60 * 1000
    return byHostess.filter((r) => {
      if (r.payout_status !== "paid" && r.payout_status !== "held") return false
      if (r.payout_status === "paid" && r.payout_paid_at) {
        const paidMs = new Date(r.payout_paid_at).getTime()
        if (Number.isNaN(paidMs)) return true
        return paidMs > cutoff
      }
      return true
    })
  }, [byHostess])
  // R-pending-count (2026-08-25): 미정산 (unpaid) hostess 수 · pending 페이지 링크에 표시.
  const pendingHostessCount = useMemo(() => {
    return byHostess.filter((r) => r.payout_status !== "paid" && r.payout_status !== "held").length
  }, [byHostess])
  const pendingHostessAmount = useMemo(() => {
    return byHostess
      .filter((r) => r.payout_status !== "paid" && r.payout_status !== "held")
      .reduce((a, r) => a + (r.gross_total ?? 0), 0)
  }, [byHostess])

  // R-manager-group (2026-08-25): 사용자 요구 "실장별로 분류 · 내 아가씨 · 내 정산".
  //   visibleByHostess 를 담당 실장 (manager_membership_id) 별로 그룹핑.
  //   Owner 는 실장 여러 그룹 · manager 는 서버가 이미 자기 담당만 반환.
  //   미배정 (manager 없는 hostess) 는 마지막 그룹 "미배정" 로 표시.
  const groupedByManager = useMemo(() => {
    type Group = { managerName: string; rows: typeof visibleByHostess }
    const map = new Map<string, Group>()
    for (const h of visibleByHostess) {
      const key = h.manager_membership_id ?? "__unassigned__"
      const managerName = h.manager_name ?? "미배정"
      if (!map.has(key)) map.set(key, { managerName, rows: [] })
      map.get(key)!.rows.push(h)
    }
    return [...map.entries()].sort((a, b) => {
      if (a[0] === "__unassigned__") return 1
      if (b[0] === "__unassigned__") return -1
      // rows 많은 실장이 위 (활동 많은 순)
      if (b[1].rows.length !== a[1].rows.length) return b[1].rows.length - a[1].rows.length
      return a[1].managerName.localeCompare(b[1].managerName, "ko")
    })
  }, [visibleByHostess])

  async function verifyAndReset() {
    const pw = password.trim()
    if (!pw || verifying) return
    setVerifying(true)
    haptic([10, 30, 10])
    try {
      const res = await apiFetch("/api/auth/verify-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw }),
      })
      if (res.status === 401) {
        toast("비밀번호가 일치하지 않습니다", "error")
        return
      }
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        toast(`확인 실패: ${j?.message ?? res.status}`, "error")
        return
      }
      // 확인 성공 — localStorage 에 reset 시각 저장
      const key = resetKey(me.data?.membership_id)
      if (key && typeof window !== "undefined") {
        const now = new Date().toISOString()
        window.localStorage.setItem(key, now)
        setResetAt(new Date(now))
      }
      toast("내 정산 화면이 초기화됐습니다", "success")
      setResetSheetOpen(false)
      setPassword("")
    } catch (e) {
      toast(`오류: ${(e as Error).message}`, "error")
    } finally {
      setVerifying(false)
    }
  }

  function undoReset() {
    const key = resetKey(me.data?.membership_id)
    if (key && typeof window !== "undefined") {
      window.localStorage.removeItem(key)
    }
    setResetAt(null)
    toast("초기화 해제 — 정산 다시 표시", "info")
  }

  return (
    <div className="flex flex-col min-h-full">
      <PageHeader
        title="정산"
        subtitle={`${me.data?.full_name ?? ""} · ${me.data?.store_name ?? ""}`}
        backHref="/m"
        right={
          <div className="flex items-center gap-1.5">
            <Link
              href="/m/settle/print"
              className="text-[10px] font-extrabold text-[#2D2B26] bg-white border border-[#D8D2C8] rounded-full px-2.5 py-1.5"
              title="마감 리포트 인쇄/PDF"
            >
              🖨️ 마감
            </Link>
            <button
              type="button"
              onClick={() => setResetSheetOpen(true)}
              className="text-[10px] font-extrabold text-red-600 bg-red-50 border border-red-200 rounded-full px-3 py-1.5"
            >
              🗑 초기화
            </button>
          </div>
        }
      />

      <div className="px-5 pb-24">
        {/* 초기화 상태 배너 */}
        {isReset && resetAt && (
          <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl px-4 py-3 mb-3 flex items-center gap-3">
            <span className="text-[20px]">🔄</span>
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-extrabold text-amber-800">
                내 정산 화면 초기화됨 · {fmtRelative(resetAt)} 전
              </div>
              <div className="text-[10px] font-semibold text-amber-700 mt-0.5">
                서버 데이터는 그대로 보존됩니다. 7일 후 자동 해제.
              </div>
            </div>
            <button
              type="button"
              onClick={undoReset}
              className="shrink-0 text-[10px] font-extrabold bg-white text-amber-800 border border-amber-300 rounded-full px-3 py-1.5"
            >
              해제
            </button>
          </div>
        )}

        {/* R-hide-summary (2026-08-25): 사용자 요청 · 상단 4개 섹션 숨김.
           오늘/이번주 탭 · 오늘 스태프 매출 총액 카드 · AI 요약 버튼 · 매출 트렌드
           14일 chart 모두 렌더 X. 아래 "내 장부" 부터 시작. 코드는 필요 시 revert. */}

        {/* 내 장부 — 오늘 실데이터 (manager_amount 합계) */}
        <div className="bg-gradient-to-br from-[#2D2B26] to-[#1a1813] rounded-3xl p-5 mb-4 text-white shadow-lg relative overflow-hidden">
          <div className="absolute -top-10 -right-10 w-36 h-36 bg-[#C49B61]/25 rounded-full blur-2xl pointer-events-none" />
          <div className="relative">
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[10px] font-extrabold text-[#E4C99A] uppercase tracking-widest">📒 내 장부</div>
              <div className="text-[9px] font-bold text-white/50">오늘 실장 순수익</div>
            </div>
            <div className="flex items-baseline gap-1 mb-4">
              <span className="text-[38px] font-extrabold tracking-tighter text-[#E4C99A]">
                +{fmtMoney(myProfit, { unit: false })}
              </span>
              <span className="text-[16px] text-white/70 font-bold">만원</span>
            </div>
            <div className="grid grid-cols-3 gap-2 pt-3 border-t border-white/15">
              <Card v={fmtMoneyWon(total)} l="오늘 매출" />
              <Card v={fmtMoneyWon(totalHostessPayout)} l="식구 지급" />
              <Card v={fmtMoneyWon(totalManagerJjing)} l="찡값 수익" />
            </div>
          </div>
        </div>

        {/* R-external-top (2026-08-23): 외부 매장 정산 섹션을 스태프별 위로 이동.
         이전엔 페이지 최하단 → pill button 으로 scroll jump 했지만 · 페이지 남은
         공간이 짧아서 스크롤 후 큰 공백 (사용자 리포트: "화면이 틀어진다").
         근본 해결: 섹션 자체를 상단 (내 장부 아래 · 스태프별 위) 에 배치. */}
        <div className="mb-4">
          <IncomingStaffSection
            groups={incoming.data?.groups ?? []}
            isLoading={incoming.isLoading}
            grandPrice={incoming.data?.grand_total_price ?? 0}
            grandHostess={incoming.data?.grand_total_hostess_payout ?? 0}
          />
        </div>

        {/* R-pending-split (2026-08-25): 미정산 이월 링크 카드 · 별도 페이지로 이동.
           사용자 요청 "이건 하루전꺼다 · 미정산은 따로 메뉴에 넣어서 · 오늘은 오늘". */}
        {pendingHostessCount > 0 && (
          <Link
            href="/m/settle/pending"
            className="mb-3 flex items-center justify-between rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3 no-underline active:bg-amber-100"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 shrink-0 rounded-xl bg-amber-100 flex items-center justify-center text-[16px]">
                📦
              </div>
              <div className="text-left min-w-0">
                <div className="text-[12px] font-extrabold text-[#2D2B26]">미정산 이월</div>
                <div className="text-[10px] font-bold text-[#7A746A] mt-0.5">
                  {pendingHostessCount}명 · 총 {fmtMoneyWon(pendingHostessAmount)}
                </div>
              </div>
            </div>
            <span className="text-[14px] text-[#A87D45] shrink-0">→</span>
          </Link>
        )}

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
        {byHostess.length > 0 && groupedByManager.map(([groupKey, group]) => {
          // R-manager-group (2026-08-25): 각 실장 그룹 header + 소속 아가씨 카드 리스트.
          //   Owner 는 매장 전체 실장 다 볼 수 있고 · manager 는 자기 담당만 (서버 필터).
          const groupGross = group.rows.reduce((a, r) => a + (r.gross_total ?? 0), 0)
          const groupCount = group.rows.length
          return (
          <div key={groupKey} className="mb-3">
            <div className="flex items-baseline justify-between mb-1.5 px-1">
              <div className="text-[12px] font-extrabold text-[#2D2B26]">
                {group.managerName}
                <span className="ml-1.5 text-[10px] font-bold text-[#7A746A]">
                  · 아가씨 {groupCount}명
                </span>
              </div>
              <div className="text-[11px] font-extrabold text-[#A87D45]">
                {fmtMoneyWon(groupGross)}
              </div>
            </div>
          <div className="bg-white rounded-2xl overflow-hidden border border-[#D8D2C8]/60">
            {group.rows.map((h, i) => {
              const breakdown = h.store_breakdown ?? []
              const breakdownText = breakdown
                .map((b) => `${b.store_name} ${b.count}`)
                .join(" · ")
              const gross = h.gross_total ?? 0
              const payout = h.hostess_amount ?? 0
              const jjing = h.manager_amount ?? 0
              const sameAmount = gross === payout
              const hasJjing = jjing > 0
              // R-payout-server-state (2026-06-27): 서버 응답 payout_status 우선,
              //   로컬 quickStatus 는 갱신 직후 낙관적 UI.
              const qs = quickStatus.get(h.hostess_id) ?? h.payout_status
              const isPaid = qs === "paid"
              const isHeld = qs === "held"
              const busy = quickBusy === h.hostess_id
              // 정산완료 시각 (HH:MM)
              const paidTime = isPaid && h.payout_paid_at
                ? new Date(h.payout_paid_at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false })
                : null
              return (
                <div
                  key={h.hostess_id}
                  className={cn(
                    "px-4 py-3",
                    i > 0 && "border-t border-[#D8D2C8]/40",
                    isPaid && "bg-green-50/60",
                    isHeld && "bg-amber-50/60",
                  )}
                >
                  {/* R-inline-expand (2026-08-23): 이름 클릭 → 인라인 세부 (심플화) */}
                  <button
                    type="button"
                    onClick={() => toggleExpand(h.hostess_id)}
                    className="w-full flex items-center gap-3 text-left active:opacity-60 transition-opacity"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-extrabold tracking-tight text-[#2D2B26] flex items-center gap-1.5 flex-wrap">
                        <span>{h.hostess_name}</span>
                        <span className="text-[10px] font-bold text-[#A87D45]">
                          {h.tc_count ?? 0}타임
                        </span>
                        {isPaid && (
                          <span className="text-[9px] font-extrabold text-green-700 bg-green-200/70 px-1.5 py-0.5 rounded-full border border-green-300">
                            ✓ 정산완료{paidTime ? ` ${paidTime}` : ""}
                          </span>
                        )}
                        {isHeld && (
                          <span className="text-[9px] font-extrabold text-amber-700 bg-amber-200/70 px-1.5 py-0.5 rounded-full border border-amber-300">
                            📦 보관
                          </span>
                        )}
                      </div>
                      {breakdownText && (
                        <div className="text-[10px] font-semibold text-[#7A746A] truncate mt-0.5">
                          {breakdownText}
                        </div>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[14px] font-extrabold tracking-tight text-[#2D2B26]">
                        {fmtMoneyWon(gross)}
                      </div>
                      {/* R-mask-zero (2026-08-23): owner 마스킹으로 payout/jjing 이
                       0/0 이면 개별 값 노출 노이즈만 됨 (상단 header 에 매장 총액 있음).
                       두 값 다 0 이면 이 라인 자체 렌더 X. */}
                      {payout === 0 && jjing === 0 ? null : sameAmount && !hasJjing ? (
                        <div className="text-[9px] font-semibold text-[#7A746A]">찡값 X · 전액 지급</div>
                      ) : (
                        <>
                          <div className="text-[9px] font-extrabold text-green-700">
                            지급 {(payout / 10000).toFixed(payout % 10000 === 0 ? 0 : 1)}만
                          </div>
                          <div className={cn(
                            "text-[9px] font-extrabold mt-0.5",
                            hasJjing ? "text-[#A87D45]" : "text-[#B4B2A9]",
                          )}>
                            찡 {(jjing / 10000).toFixed(jjing % 10000 === 0 ? 0 : 1)}만
                          </div>
                        </>
                      )}
                    </div>
                  </button>
                  {/* R-inline-expand (2026-08-23): 확장 시 세션별 상세 표시 */}
                  {expandedRows.has(h.hostess_id) && (
                    <InlineHostessDetail
                      hostessId={h.hostess_id}
                      businessDayId={settle.data?.business_day_id ?? null}
                      breakdown={h.store_breakdown ?? []}
                    />
                  )}
                  {/* 빠른 액션 버튼 — 즉시 PATCH */}
                  <div className="flex items-center gap-1.5 mt-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={(e) => { e.stopPropagation(); quickPayout(h.hostess_id, "paid") }}
                      className={cn(
                        "flex-1 rounded-lg py-1.5 text-[11px] font-extrabold border-2 transition-all disabled:opacity-40",
                        isPaid
                          ? "bg-green-100 border-green-400 text-green-700"
                          : "bg-white border-green-300 text-green-700 active:bg-green-50",
                      )}
                    >
                      {busy && !isPaid ? "..." : isPaid ? "✓ 정산완료 (해제하려면 상세)" : "✓ 정산완료"}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={(e) => { e.stopPropagation(); quickPayout(h.hostess_id, "held") }}
                      className={cn(
                        "flex-1 rounded-lg py-1.5 text-[11px] font-extrabold border-2 transition-all disabled:opacity-40",
                        isHeld
                          ? "bg-amber-100 border-amber-400 text-amber-700"
                          : "bg-white border-amber-300 text-amber-700 active:bg-amber-50",
                      )}
                    >
                      {busy && !isHeld ? "..." : isHeld ? "📦 보관됨" : "📦 보관"}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setPayoutTarget({ id: h.hostess_id, name: h.hostess_name }) }}
                      className="rounded-lg px-2.5 py-1.5 text-[11px] font-extrabold border-2 border-[#D8D2C8] text-[#7A746A] bg-white active:bg-[#FAF5EC]"
                      title="팁 / 메모 / 상세 입력"
                    >
                      💸
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
          </div>
          )
        })}
        {byHostess.length > 0 && (
          <div className="bg-[#FAF5EC] border-2 border-[#C49B61]/30 rounded-2xl px-4 py-3 mt-2 flex items-center justify-between">
            <div className="text-[11px] font-extrabold text-[#2D2B26]">총 지급해야 할 금액</div>
            <div className="text-[15px] font-extrabold text-[#A87D45]">
              {fmtMoneyWon(totalHostessPayout)}
            </div>
          </div>
        )}

        {/* R-external-top (2026-08-23): 위쪽으로 이동됨 · 이전 렌더 위치 제거. */}
      </div>

      <TabBar />

      {/* 세부 정산 시트 — 세션별, 종목별, 시간당 공제 (이름 클릭) */}
      {detailTarget && (
        <StaffDetailSheet
          open={!!detailTarget}
          onClose={() => setDetailTarget(null)}
          hostessId={detailTarget.id}
          hostessName={detailTarget.name}
        />
      )}

      {/* 팁 / 메모 시트 — 💸 버튼 전용 (기존) */}
      {payoutTarget && (
        <StaffPayoutSheet
          open={!!payoutTarget}
          onClose={() => setPayoutTarget(null)}
          hostessId={payoutTarget.id}
          hostessName={payoutTarget.name}
        />
      )}

      {/* 정산 초기화 모달 (비밀번호 확인) */}
      <Sheet
        open={resetSheetOpen}
        onClose={() => {
          setResetSheetOpen(false)
          setPassword("")
        }}
        title="정산 초기화"
        desc="본인 정산 화면을 0 으로 초기화합니다. 다른 사용자의 화면 / 서버 데이터는 영향 없음."
        footer={
          <>
            <button
              type="button"
              onClick={() => {
                setResetSheetOpen(false)
                setPassword("")
              }}
              className="flex-1 bg-[#EFEBE3] text-[#2D2B26] rounded-xl py-3 text-[13px] font-extrabold"
            >
              취소
            </button>
            <button
              type="button"
              onClick={verifyAndReset}
              disabled={!password.trim() || verifying}
              className="flex-1 bg-red-600 text-white rounded-xl py-3 text-[13px] font-extrabold disabled:opacity-40"
            >
              {verifying ? "확인 중..." : "초기화"}
            </button>
          </>
        }
      >
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 text-[11px] font-semibold text-amber-800 mb-3 leading-relaxed">
          · 초기화는 <b>본인 화면만</b> 영향. 사장/타 실장 view, 서버 기록은 그대로.
          <br />· 7일 후 자동 해제 — 다시 누적되어 표시됩니다.
          <br />· 이메일: <b>{me.data?.full_name ?? "—"}</b>
        </div>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && password.trim() && !verifying) verifyAndReset()
          }}
          autoComplete="current-password"
          placeholder="현재 비밀번호"
          className="w-full bg-white border border-[#D8D2C8] rounded-xl px-4 py-3 text-[14px] font-semibold outline-none focus:border-red-500"
        />
      </Sheet>
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

/**
 * R-incoming-staff (2026-06-25): 본 매장에서 일하는/일한 타매장 식구.
 *   origin_store + origin_manager 별 그룹 표시.
 *   줄돈/받을돈 검증 — 타매장에게 줘야 할 hostess_payout 합계 (per origin).
 */
function IncomingStaffSection({
  groups,
  isLoading,
  grandPrice,
  grandHostess,
}: {
  groups: IncomingStaffGroup[]
  isLoading: boolean
  grandPrice: number
  grandHostess: number
}) {
  // R-incoming-collapse (2026-06-26): 매장별 접기/펼치기 — 기본 접힘.
  //   전부 펼치면 화면 길어져 매장간 비교 불편.
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  // R-cross-payout-settle (2026-06-26): 정산완료 토글 busy state (그룹 단위)
  const [settling, setSettling] = useState<string | null>(null)
  // R-edit-participant (2026-06-26): 수정 시트 타겟
  const [editTarget, setEditTarget] = useState<IncomingStaffParticipant | null>(null)
  const toast = useToast()

  function toggle(key: string) {
    setExpanded((prev) => {
      const n = new Set(prev)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })
  }

  async function toggleSettlement(g: IncomingStaffGroup, key: string, settled: boolean) {
    if (settling) return
    setSettling(key)
    try {
      const res = await apiFetch("/api/cross-store/settle-group", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          origin_store_uuid: g.origin_store_uuid,
          origin_manager_membership_id: g.origin_manager_membership_id,
          settled,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j?.message ?? `HTTP ${res.status}`)
      toast(settled ? "정산완료 표시됨" : "정산완료 해제됨", "success")
      invalidateApi("/api/manager/incoming-staff")
    } catch (e) {
      toast(`처리 실패: ${(e as Error).message}`, "error")
    } finally {
      setSettling(null)
    }
  }

  if (isLoading) {
    return (
      <div id="incoming-staff-section" className="mt-6 mb-2 scroll-mt-4">
        <div className="text-[13px] font-extrabold mb-2">🔄 우리 매장 들어온 타매장 식구</div>
        <div className="h-16 rounded-2xl bg-[#EFEBE3] animate-pulse" />
      </div>
    )
  }
  // R-empty-state (2026-08-23): groups=0 이면 return null 이라 사용자가
  //   "이 섹션 어디?" 오해. 최소 안내 카드 노출.
  if (groups.length === 0) {
    return (
      <div id="incoming-staff-section" className="mt-6 mb-2 scroll-mt-4">
        <div className="text-[13px] font-extrabold mb-2">🔄 우리 매장 들어온 타매장 식구</div>
        <div className="rounded-2xl border border-dashed border-[#D8D2C8] bg-[#FAF5EC]/60 px-4 py-5 text-center">
          <div className="text-[12px] font-bold text-[#7A746A]">
            오늘 외부 매장 식구 없음
          </div>
          <div className="text-[10px] text-[#7A746A]/70 mt-1 leading-relaxed">
            다른 매장 아가씨가 우리 매장에서 일하면
            <br />여기에 매장별 · 실장별로 정산 금액이 뜹니다
          </div>
        </div>
      </div>
    )
  }

  const allExpanded = groups.length > 0 && expanded.size === groups.length

  return (
    <div id="incoming-staff-section" className="mt-6 mb-2 scroll-mt-4">
      <div className="flex items-baseline justify-between mb-2">
        <div className="text-[13px] font-extrabold">🔄 우리 매장 들어온 타매장 식구</div>
        <div className="text-[10px] font-bold text-[#A87D45]">
          총 매출 {fmtMoneyWon(grandPrice)} · <span className="text-red-700">줄돈 {fmtMoneyWon(grandHostess)}</span>
        </div>
      </div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] font-semibold text-[#7A746A] bg-blue-50 border border-blue-200 rounded-xl px-3 py-2 leading-snug flex-1 mr-2">
          본 매장에서 일하는 타매장 식구는 줄돈을 원소속 매장에 정산해야 합니다.
          <br />매장 카드를 탭하면 세부내역이 펼쳐집니다.
        </div>
        <button
          type="button"
          onClick={() => {
            if (allExpanded) setExpanded(new Set())
            else {
              const all = new Set<string>()
              groups.forEach((g, idx) => all.add(`${g.origin_store_uuid}-${g.origin_manager_membership_id ?? "x"}-${idx}`))
              setExpanded(all)
            }
          }}
          className="shrink-0 text-[10px] font-extrabold border border-[#D8D2C8] rounded-full px-2.5 py-1.5 text-[#7A746A] bg-white"
        >
          {allExpanded ? "▴ 전부 접기" : "▾ 전부 펼치기"}
        </button>
      </div>
      <div className="space-y-2">
        {groups.map((g, idx) => {
          const key = `${g.origin_store_uuid}-${g.origin_manager_membership_id ?? "x"}-${idx}`
          const isOpen = expanded.has(key)
          const status = g.settlement_status ?? "none"
          const isAllSettled = status === "all_settled"
          const isPartial = status === "partial"
          return (
            <div
              key={key}
              className={cn(
                "rounded-2xl border overflow-hidden transition-colors",
                isAllSettled
                  ? "bg-green-50/60 border-green-300"
                  : "bg-white border-[#D8D2C8]/60",
              )}
            >
              {/* 그룹 헤더 — 클릭 시 토글 */}
              <button
                type="button"
                onClick={() => toggle(key)}
                className={cn(
                  "w-full px-4 py-2.5 flex items-center justify-between gap-2 text-left",
                  isAllSettled
                    ? "bg-gradient-to-br from-green-100 to-green-50 active:bg-green-100"
                    : "bg-gradient-to-br from-[#FAF5EC] to-[#F0E8D8] active:bg-[#F0E8D8]",
                )}
              >
                <div className="min-w-0 flex items-center gap-2">
                  <span className={cn(
                    "text-[12px] font-extrabold text-[#A87D45] transition-transform",
                    isOpen && "rotate-90",
                  )}>
                    ▸
                  </span>
                  <div className="min-w-0">
                    <div className="text-[13px] font-extrabold tracking-tight text-[#2D2B26] flex items-center gap-1.5 flex-wrap">
                      <span>{g.origin_store_name}</span>
                      <span className="text-[10px] text-[#7A746A] font-bold">· {g.origin_manager_name ?? "미배정"} 실장</span>
                      {isAllSettled && (
                        <span className="text-[9px] font-extrabold text-green-700 bg-green-200/70 px-1.5 py-0.5 rounded-full border border-green-300">
                          ✓ 정산완료
                        </span>
                      )}
                      {isPartial && (
                        <span className="text-[9px] font-extrabold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full border border-amber-300">
                          ⚠ {g.settled_count ?? 0}/{(g.settled_count ?? 0) + (g.unsettled_count ?? 0)} 정산
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] font-bold text-[#7A746A] mt-0.5">
                      진행 {g.active_count} / 종료 {g.finished_count} · 총 {g.participants.length}타임
                    </div>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[12px] font-extrabold text-[#2D2B26]">{fmtMoneyWon(g.total_price)}</div>
                  <div className={cn(
                    "text-[9px] font-bold",
                    isAllSettled ? "text-green-700 line-through" : "text-red-700",
                  )}>
                    줄돈 {fmtMoneyWon(g.total_hostess_payout)}
                  </div>
                </div>
              </button>
              {/* 참여자 목록 + 정산완료 버튼 — expanded 시만 */}
              {isOpen && (
                <>
                  <div className="divide-y divide-[#D8D2C8]/40">
                    {g.participants.map((p) => {
                      const pSettled = !!p.payout_settled_at
                      return (
                        <div key={p.participant_id} className="flex items-center justify-between px-4 py-2 gap-2">
                          <div className="min-w-0 flex items-center gap-2">
                            <span
                              className={cn(
                                "w-1.5 h-1.5 rounded-full shrink-0",
                                p.status === "active" ? "bg-green-500 animate-pulse" : "bg-[#94A3B8]",
                              )}
                            />
                            <div className="min-w-0">
                              <div className="text-[12px] font-extrabold text-[#2D2B26] truncate">
                                {p.hostess_name}
                                <span className="text-[9px] font-bold text-[#A87D45] ml-1.5">
                                  {p.category}{p.time_minutes != null && ` ${p.time_minutes}분`}
                                </span>
                                {pSettled && <span className="text-[9px] text-green-700 ml-1">✓</span>}
                              </div>
                              <div className="text-[9px] font-semibold text-[#7A746A]">
                                {p.status === "active" ? "🟢 일하는 중" : "✓ 종료"}
                                {p.entered_at && ` · ${formatClockTime(p.entered_at)}`}
                                {p.left_at && ` → ${formatClockTime(p.left_at)}`}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <div className="text-right">
                              <div className="text-[11px] font-extrabold text-[#2D2B26]">{fmtMoneyWon(p.price_amount)}</div>
                              <div className={cn(
                                "text-[9px] font-bold",
                                pSettled ? "text-green-700 line-through" : "text-red-700",
                              )}>
                                줄 {fmtMoney(p.hostess_payout_amount)}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setEditTarget(p) }}
                              className="text-[14px] px-1.5 py-1 rounded-md hover:bg-[#FAF5EC] active:bg-[#F0E8D8] text-[#A87D45]"
                              aria-label="수정"
                              title="시간/금액 수정"
                            >
                              ✏️
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  {/* 정산완료 토글 영역 */}
                  <div className="px-4 py-2.5 bg-[#FAF5EC]/60 border-t border-[#D8D2C8]/40 flex items-center justify-between gap-2">
                    <div className="text-[10px] font-bold text-[#7A746A]">
                      원소속({g.origin_store_name})에 줄돈 전달 완료?
                    </div>
                    {isAllSettled ? (
                      <button
                        type="button"
                        disabled={settling === key}
                        onClick={() => toggleSettlement(g, key, false)}
                        className="text-[11px] font-extrabold bg-white text-green-700 border-2 border-green-400 rounded-full px-3 py-1.5 disabled:opacity-40"
                      >
                        ✓ 정산완료 (해제)
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={settling === key}
                        onClick={() => toggleSettlement(g, key, true)}
                        className="text-[11px] font-extrabold bg-gradient-to-br from-green-500 to-green-600 text-white rounded-full px-3 py-1.5 disabled:opacity-40 shadow-sm"
                      >
                        💰 정산완료 표시
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>

      {/* 수정 시트 */}
      {editTarget && (
        <EditParticipantSheet
          open={!!editTarget}
          onClose={() => setEditTarget(null)}
          participantId={editTarget.participant_id}
          hostessName={editTarget.hostess_name}
          category={editTarget.category}
          timeMinutes={editTarget.time_minutes}
          priceAmount={editTarget.price_amount}
          managerPayout={editTarget.manager_payout_amount}
        />
      )}
    </div>
  )
}

function formatClockTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

/**
 * R-inline-expand (2026-08-23): 정산 페이지 스태프 카드 인라인 세부 · 심플 accordion.
 *   이름 클릭 시 · 별도 시트 대신 · 그 자리에서 세션 리스트 표시.
 *   1) breakdown (매장별 카운트) 즉시 표시
 *   2) 실 세션 리스트 lazy fetch · /api/manager/hostesses/[id]/sessions?business_day_id=xxx
 */
function InlineHostessDetail({
  hostessId,
  businessDayId,
  breakdown,
}: {
  hostessId: string
  businessDayId: string | null
  breakdown: Array<{ store_uuid: string; store_name: string; count: number }>
}) {
  type SessionRow = {
    participant_id: string
    session_id: string
    store_name: string
    room_no: string | null
    category: string | null
    time_minutes: number | null
    price_amount: number
    entered_at: string
    left_at: string | null
    status: string
  }
  const [sessions, setSessions] = useState<SessionRow[] | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const url = `/api/manager/hostesses/${encodeURIComponent(hostessId)}/sessions${businessDayId ? `?business_day_id=${encodeURIComponent(businessDayId)}` : ""}`
        const r = await apiFetch(url)
        if (!r.ok) throw new Error("fetch failed")
        const j = await r.json() as { sessions?: SessionRow[] }
        if (!cancelled) setSessions(j.sessions ?? [])
      } catch {
        if (!cancelled) setSessions([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [hostessId, businessDayId])

  const fmtHm = (iso: string) => {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return "?"
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
  }
  const fmtWon = (n: number) => n >= 10000 ? `${Math.floor(n / 10000)}만원` : `${n.toLocaleString()}원`

  return (
    <div className="mt-2 border-t border-[#EDE7DA] pt-2 flex flex-col gap-1">
      {/* 매장별 요약 */}
      {breakdown.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1">
          {breakdown.map((b) => (
            <span key={b.store_uuid} className="inline-flex items-center rounded-md bg-[#C49B61]/15 text-[#8C6A3A] px-2 py-0.5 text-[10px] font-black">
              {b.store_name} · {b.count}타임
            </span>
          ))}
        </div>
      )}
      {/* 세션 리스트 */}
      {loading && <div className="text-[10px] text-[#7A746A] py-1">불러오는 중...</div>}
      {!loading && sessions && sessions.length === 0 && (
        <div className="text-[10px] text-[#7A746A] py-1">세션 이력 없음</div>
      )}
      {!loading && sessions && sessions.length > 0 && (
        <div className="flex flex-col gap-0.5">
          {sessions.map((s) => {
            const cat = s.category === "퍼블릭" ? "P" : s.category === "셔츠" ? "S" : s.category === "하퍼" ? "H" : "-"
            const catCls = cat === "P" ? "bg-[#6B8AFD]/20 text-[#3E5EDB]"
              : cat === "H" ? "bg-[#D97757]/20 text-[#A94B2A]"
                : cat === "S" ? "bg-[#D9A557]/20 text-[#8C6A2A]"
                  : "bg-[#EDE7DA] text-[#7A746A]"
            return (
              <div key={s.participant_id} className="flex items-center gap-2 text-[11px] bg-white/50 rounded px-2 py-1">
                <span className="font-mono font-bold text-[#7A746A] w-10">{fmtHm(s.entered_at)}</span>
                <span className={cn("inline-flex items-center justify-center min-w-[16px] h-4 rounded text-[9px] font-black shrink-0", catCls)}>
                  {cat}
                </span>
                <span className="font-extrabold text-[#2D2B26] truncate">
                  {s.store_name}{s.room_no ? ` ${s.room_no}번방` : ""}
                </span>
                <span className="text-[10px] font-bold text-[#7A746A] ml-auto">
                  {s.time_minutes ? `${s.time_minutes}분` : "-"}
                </span>
                <span className="text-[10px] font-black text-[#8C6A3A]">
                  {s.price_amount > 0 ? fmtWon(s.price_amount) : "-"}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
