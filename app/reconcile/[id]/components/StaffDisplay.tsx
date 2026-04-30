"use client"

/**
 * StaffDisplay — 스태프 종이장부 추출 결과 구조화 표시.
 *
 * 2026-04-30: 그동안 staff sheet 는 raw JSON 으로만 표시됨.
 *   이 컴포넌트가 hostess 별 카드로 정렬:
 *     - 이름 (hostess_name)
 *     - 일별 합계 (daily_totals → 총갯수 / 줄돈)
 *     - 세션 list: 시간 / 가게 / 종목 / 시간티어 / raw_text / confidence
 *
 *   read-only. 편집 (paper_ledger_edits 저장) 은 별도 라운드.
 *   매칭 실패 (빈 store / unknown service_type) 도 그대로 표시 → 사용자가
 *   raw_text 보고 즉시 인지 가능.
 */

import type { PaperExtraction, PaperStaffRow, StaffSession } from "@/lib/reconcile/types"
import ConfidenceBadge from "./ConfidenceBadge"

const SERVICE_LABEL: Record<string, string> = {
  퍼블릭: "퍼블릭",
  셔츠: "셔츠",
  하퍼: "하퍼",
}

const TIER_LABEL: Record<string, string> = {
  free: "free",
  차3: "차3",
  반티: "반티",
  반차3: "반차3",
  완티: "완티",
  unknown: "?",
}

export default function StaffDisplay({
  extraction,
}: {
  extraction: PaperExtraction
}) {
  const staff = (extraction.staff ?? []) as PaperStaffRow[]
  if (staff.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center text-sm text-slate-500">
        스태프 row 가 추출되지 않았습니다.
        <div className="text-[11px] text-slate-600 mt-2">
          이미지 품질이 낮거나 표 인식 실패. "재추출" 또는 더 선명한 사진 필요.
        </div>
      </div>
    )
  }

  // 줄돈/받돈 합계 (daily_summary)
  const summary = extraction.daily_summary
  const oweTotal = (summary?.owe ?? []).reduce((s, x) => s + (x.amount_won ?? 0), 0)
  const recvTotal = (summary?.recv ?? []).reduce((s, x) => s + (x.amount_won ?? 0), 0)

  return (
    <div className="space-y-3">
      {/* 헤더 + 합계 */}
      <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/[0.04] p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-cyan-200">📋 스태프 장부 요약</div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              총 {staff.length} 명 / 영업일 {extraction.business_date ?? "?"}
            </div>
          </div>
          {(oweTotal > 0 || recvTotal > 0) && (
            <div className="flex gap-3 text-right">
              {oweTotal > 0 && (
                <div>
                  <div className="text-[10px] text-slate-500">줄돈 합</div>
                  <div className="text-sm font-semibold text-amber-300 tabular-nums">
                    {oweTotal.toLocaleString()}원
                  </div>
                </div>
              )}
              {recvTotal > 0 && (
                <div>
                  <div className="text-[10px] text-slate-500">받돈 합</div>
                  <div className="text-sm font-semibold text-emerald-300 tabular-nums">
                    {recvTotal.toLocaleString()}원
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* hostess 별 카드 */}
      {staff.map((row, idx) => (
        <HostessCard key={`${row.hostess_name}-${idx}`} row={row} idx={idx} />
      ))}

      {/* 매장 줄돈/받돈 박스 (있을 때만) */}
      {summary && ((summary.owe?.length ?? 0) > 0 || (summary.recv?.length ?? 0) > 0) && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="text-sm font-semibold mb-2">매장별 정산 (줄돈/받돈)</div>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <div className="text-amber-300 mb-1">줄돈 (우리가 줄 돈)</div>
              {(summary.owe ?? []).length === 0 ? (
                <div className="text-slate-600">없음</div>
              ) : (
                <ul className="space-y-1">
                  {(summary.owe ?? []).map((o, i) => (
                    <li key={i} className="flex justify-between border-b border-white/5 py-1">
                      <span>{o.store_name}</span>
                      <span className="tabular-nums">{o.amount_won.toLocaleString()}원</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <div className="text-emerald-300 mb-1">받돈 (받을 돈)</div>
              {(summary.recv ?? []).length === 0 ? (
                <div className="text-slate-600">없음</div>
              ) : (
                <ul className="space-y-1">
                  {(summary.recv ?? []).map((r, i) => (
                    <li key={i} className="flex justify-between border-b border-white/5 py-1">
                      <span>{r.store_name}</span>
                      <span className="tabular-nums">{r.amount_won.toLocaleString()}원</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function HostessCard({ row, idx }: { row: PaperStaffRow; idx: number }) {
  const sessions = row.sessions ?? []
  const totals = row.daily_totals ?? []
  // 일반적으로 daily_totals = [총갯수, 줄돈] 두 값 (오른쪽 두 컬럼).
  const totalCount = totals[0]
  const owe = totals[1]

  // sessions 통계 — 종목 별 카운트
  const serviceTally: Record<string, number> = {}
  for (const s of sessions) {
    const sv = s.service_type ?? "?"
    serviceTally[sv] = (serviceTally[sv] ?? 0) + 1
  }
  const serviceList = Object.entries(serviceTally)
    .filter(([k]) => k !== "?" && k !== "null")
    .map(([k, v]) => `${SERVICE_LABEL[k] ?? k}×${v}`)
    .join(" / ")

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
      {/* hostess header */}
      <div className="px-4 py-2.5 bg-white/[0.04] flex items-center justify-between border-b border-white/5">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-500">#{idx + 1}</span>
          <span className="text-base font-semibold text-cyan-200">
            {row.hostess_name || <span className="text-slate-600 text-sm">(이름 미상)</span>}
          </span>
          {serviceList && (
            <span className="text-[10px] text-slate-400 px-2 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/20">
              {serviceList}
            </span>
          )}
        </div>
        <div className="flex gap-3 text-right">
          {typeof totalCount === "number" && (
            <div>
              <div className="text-[10px] text-slate-500">총갯수</div>
              <div className="text-sm font-semibold text-cyan-300 tabular-nums">{totalCount}</div>
            </div>
          )}
          {typeof owe === "number" && (
            <div>
              <div className="text-[10px] text-slate-500">줄돈</div>
              <div className="text-sm font-semibold text-amber-300 tabular-nums">{owe}</div>
            </div>
          )}
        </div>
      </div>

      {/* sessions table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-500 border-b border-white/5">
              <th className="text-left px-3 py-1.5 w-16">시간</th>
              <th className="text-left px-3 py-1.5 w-24">가게</th>
              <th className="text-left px-3 py-1.5 w-20">종목</th>
              <th className="text-left px-3 py-1.5 w-16">티어</th>
              <th className="text-left px-3 py-1.5">원본</th>
              <th className="text-right px-3 py-1.5 w-12">신뢰</th>
            </tr>
          </thead>
          <tbody>
            {sessions.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-3 text-center text-slate-600">
                  세션 없음
                </td>
              </tr>
            ) : (
              sessions.map((s, i) => <SessionRow key={i} s={s} />)
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SessionRow({ s }: { s: StaffSession }) {
  return (
    <tr className="border-b border-white/[0.03] hover:bg-white/[0.02]">
      <td className="px-3 py-1.5 tabular-nums text-slate-300">
        {s.time || <span className="text-slate-700">-</span>}
      </td>
      <td className="px-3 py-1.5">
        {s.store ? (
          <span className="text-cyan-300">{s.store}</span>
        ) : (
          <span className="text-slate-700">-</span>
        )}
      </td>
      <td className="px-3 py-1.5">
        {s.service_type ? (
          <span className="text-emerald-300">{SERVICE_LABEL[s.service_type] ?? s.service_type}</span>
        ) : (
          <span className="text-slate-700">-</span>
        )}
      </td>
      <td className="px-3 py-1.5">
        <span className={s.time_tier && s.time_tier !== "unknown" ? "text-fuchsia-300" : "text-slate-700"}>
          {TIER_LABEL[s.time_tier ?? ""] ?? "-"}
        </span>
      </td>
      <td className="px-3 py-1.5 text-slate-500 truncate max-w-[200px]">
        {s.raw_text || "-"}
      </td>
      <td className="px-3 py-1.5 text-right">
        {typeof s.confidence === "number" && <ConfidenceBadge value={s.confidence} />}
      </td>
    </tr>
  )
}
