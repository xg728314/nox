"use client"
import { useEffect } from "react"
import { useMe, useSettlement, useIncomingStaff } from "../../../_hooks/useMobileData"
import { fmtDateKo, fmtMoney, fmtMoneyWon } from "../../../_lib/format"

/**
 * 마감 리포트 인쇄 뷰 (/m/settle/print).
 *   - 정산 데이터 + 외부 식구 합쳐 A4 1장 요약.
 *   - useEffect 로 로드 완료 후 window.print() 자동 호출.
 *   - 브라우저에서 "PDF 로 저장" 선택 → PDF 파일.
 *
 * R-print-report (2026-06-28).
 */
export default function PrintReportPage() {
  const me = useMe()
  const settle = useSettlement()
  const incoming = useIncomingStaff()

  useEffect(() => {
    if (settle.isLoading || incoming.isLoading || me.isLoading) return
    // 데이터 렌더 완료 후 살짝 딜레이 두고 print
    const t = setTimeout(() => window.print(), 400)
    return () => clearTimeout(t)
  }, [settle.isLoading, incoming.isLoading, me.isLoading])

  const summary = settle.data?.summary ?? []
  const withSettlement = summary.filter((r) => r.has_settlement)
  const totalGross = withSettlement.reduce((a, r) => a + (r.gross_total ?? 0), 0)
  const totalHostessPayout = withSettlement.reduce((a, r) => a + (r.hostess_amount ?? 0), 0)
  const totalTc = withSettlement.reduce((a, r) => a + (r.tc_count ?? 0), 0)
  const settledCount = withSettlement.filter(
    (r) => r.payout_status === "paid" || r.payout_status === "held",
  ).length
  const groups = incoming.data?.groups ?? []

  return (
    <div className="p-8 bg-white text-black min-h-screen print-container">
      <style jsx global>{`
        @media print {
          @page { size: A4; margin: 12mm; }
          body { background: white; }
          .no-print { display: none !important; }
        }
      `}</style>

      {/* 헤더 */}
      <div className="border-b-2 border-black pb-3 mb-4 flex items-baseline justify-between">
        <div>
          <div className="text-[24px] font-extrabold tracking-tight">
            마감 리포트
          </div>
          <div className="text-[12px] font-semibold text-gray-700 mt-1">
            {me.data?.store_name ?? "?"} · {me.data?.full_name ?? "?"} 실장
          </div>
        </div>
        <div className="text-right">
          <div className="text-[14px] font-bold">{fmtDateKo()}</div>
          <div className="text-[10px] text-gray-600 mt-0.5">
            발행: {new Date().toLocaleString("ko-KR", { hour12: false })}
          </div>
        </div>
      </div>

      {/* 요약 */}
      <div className="grid grid-cols-4 gap-3 mb-4 pb-4 border-b border-gray-300">
        <SummaryBox label="총 매출" value={fmtMoneyWon(totalGross)} />
        <SummaryBox label="식구 지급" value={fmtMoneyWon(totalHostessPayout)} />
        <SummaryBox
          label="실장 순수익"
          value={fmtMoneyWon(Math.max(0, totalGross - totalHostessPayout))}
          highlight
        />
        <SummaryBox label="총 타임" value={`${totalTc}건`} />
      </div>

      {/* 스태프별 */}
      <div className="mb-4">
        <div className="text-[14px] font-extrabold mb-2 pb-1 border-b border-gray-400">
          스태프별 정산 ({withSettlement.length}명 · 완료 {settledCount})
        </div>
        {withSettlement.length === 0 ? (
          <div className="text-[11px] text-gray-500 py-2">기록 없음</div>
        ) : (
          <table className="w-full text-[11px]">
            <thead className="border-b border-gray-400">
              <tr>
                <th className="text-left py-1 font-bold">이름</th>
                <th className="text-right py-1 font-bold">타임</th>
                <th className="text-right py-1 font-bold">매출</th>
                <th className="text-right py-1 font-bold">지급</th>
                <th className="text-center py-1 font-bold">상태</th>
                <th className="text-left py-1 font-bold">매장 내역</th>
              </tr>
            </thead>
            <tbody>
              {withSettlement.map((r) => (
                <tr key={r.hostess_id} className="border-b border-gray-200">
                  <td className="py-1 font-bold">{r.hostess_name}</td>
                  <td className="text-right py-1">{r.tc_count ?? 0}</td>
                  <td className="text-right py-1 tabular-nums">
                    {fmtMoney(r.gross_total ?? 0)}
                  </td>
                  <td className="text-right py-1 tabular-nums">
                    {fmtMoney(r.hostess_amount ?? 0)}
                  </td>
                  <td className="text-center py-1 text-[10px]">
                    {r.payout_status === "paid"
                      ? "✓ 완료"
                      : r.payout_status === "held"
                        ? "📦 보관"
                        : "대기"}
                  </td>
                  <td className="py-1 text-[10px] text-gray-700">
                    {(r.store_breakdown ?? [])
                      .map((b) => `${b.store_name} ${b.count}`)
                      .join(" · ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 외부 식구 */}
      {groups.length > 0 && (
        <div className="mb-4">
          <div className="text-[14px] font-extrabold mb-2 pb-1 border-b border-gray-400">
            🔄 우리 매장 들어온 외부 식구
          </div>
          <table className="w-full text-[11px]">
            <thead className="border-b border-gray-400">
              <tr>
                <th className="text-left py-1 font-bold">원소속</th>
                <th className="text-left py-1 font-bold">실장</th>
                <th className="text-right py-1 font-bold">타임</th>
                <th className="text-right py-1 font-bold">매출</th>
                <th className="text-right py-1 font-bold">줄돈</th>
                <th className="text-center py-1 font-bold">상태</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g, i) => (
                <tr key={i} className="border-b border-gray-200">
                  <td className="py-1 font-bold">{g.origin_store_name}</td>
                  <td className="py-1">{g.origin_manager_name ?? "미배정"}</td>
                  <td className="text-right py-1">{g.participants.length}</td>
                  <td className="text-right py-1 tabular-nums">{fmtMoney(g.total_price)}</td>
                  <td className="text-right py-1 tabular-nums">{fmtMoney(g.total_hostess_payout)}</td>
                  <td className="text-center py-1 text-[10px]">
                    {g.settlement_status === "all_settled"
                      ? "✓ 완료"
                      : g.settlement_status === "partial"
                        ? `⚠ ${g.settled_count ?? 0}/${(g.settled_count ?? 0) + (g.unsettled_count ?? 0)}`
                        : "대기"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 text-right text-[11px] font-bold">
            타매장 지급 총합: {fmtMoneyWon(incoming.data?.grand_total_hostess_payout ?? 0)}
          </div>
        </div>
      )}

      {/* 하단 서명 */}
      <div className="mt-8 pt-4 border-t border-gray-300 flex justify-between text-[10px] text-gray-600">
        <div>
          NOX · nox.ai.kr · {me.data?.store_name}
        </div>
        <div>
          이 리포트는 자동 생성되었습니다.
        </div>
      </div>

      {/* 재인쇄 버튼 (인쇄 시 hidden) */}
      <div className="no-print mt-6 text-center">
        <button
          type="button"
          onClick={() => window.print()}
          className="px-6 py-3 bg-[#2D2B26] text-white rounded-2xl text-[14px] font-extrabold"
        >
          🖨️ 다시 인쇄 / PDF 로 저장
        </button>
        <div className="text-[11px] text-gray-500 mt-2">
          인쇄 대화상자에서 "PDF 로 저장" 을 선택하면 파일로 저장됩니다.
        </div>
      </div>
    </div>
  )
}

function SummaryBox({
  label,
  value,
  highlight,
}: {
  label: string
  value: string
  highlight?: boolean
}) {
  return (
    <div
      className={`border-2 rounded-xl p-3 ${highlight ? "border-black bg-gray-50" : "border-gray-300"}`}
    >
      <div className="text-[9px] font-bold text-gray-600 uppercase tracking-wider">
        {label}
      </div>
      <div
        className={`text-[16px] font-extrabold mt-1 ${highlight ? "text-black" : "text-gray-800"}`}
      >
        {value}
      </div>
    </div>
  )
}
