"use client"

/**
 * TextParseModal — 운영자가 종이장부를 자유 텍스트로 입력하면 Claude 가
 *   PaperExtraction JSON 으로 변환.
 *
 * R-ParseText (2026-05-01):
 *   운영자 의도: "셀별 클릭 부담. 채팅처럼 글 쓰면 NOX 가 알아서 인식하게."
 *
 *   흐름:
 *     1. 운영자가 textarea 에 자유 형식 작성.
 *     2. "AI 로 구조화" → POST /api/reconcile/[id]/parse-text.
 *     3. 응답 JSON preview.
 *     4. "에디터에 적용" → 부모 콜백으로 onApply(extraction).
 *        (부모가 paper_ledger_edits 저장 흐름 그대로 사용)
 *
 *   학습 자동: 응답 JSON 을 edit 으로 저장 시 captureSignal 이 Vision OCR
 *     결과 (있으면) 와 비교해 learning_signals 누적.
 */

import { useState } from "react"
import { apiFetch } from "@/lib/apiFetch"
import type { PaperExtraction } from "@/lib/reconcile/types"

type Props = {
  snapshot_id: string
  sheet_kind: "rooms" | "staff" | "other"
  onApply: (extraction: PaperExtraction) => void
  onClose: () => void
}

const PLACEHOLDERS: Record<string, string> = {
  rooms: `예시:
1번방 다운 준상 2인
골든 3병 병당20만원
계좌 186만원 입금 149만원
신세계6 발리 20 상한가 49 버닝 35
10:05 아영 반 신세계 하퍼

2번방 ...`,
  staff: `예시:
하영 9:30 라이브 완 / 9:09 황진이 반차3 / 10:09 황진이 반
거은 9:45 신세계 완 / 11:23 신세계 반차3
미연 ...`,
  other: `예시:
줄돈 신세계 60 발리 20 상한가 49
받돈 라이브 102 황진이 40`,
}

export default function TextParseModal({ snapshot_id, sheet_kind, onApply, onClose }: Props) {
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [result, setResult] = useState<PaperExtraction | null>(null)
  const [meta, setMeta] = useState<{ duration_ms?: number; cost_usd?: number | null } | null>(null)

  async function runParse() {
    if (text.trim().length < 5) {
      setError("텍스트를 입력하세요 (5자 이상).")
      return
    }
    setBusy(true)
    setError("")
    setResult(null)
    try {
      const r = await apiFetch(`/api/reconcile/${snapshot_id}/parse-text`, {
        method: "POST",
        body: JSON.stringify({ text }),
      })
      const d = await r.json()
      if (!r.ok) {
        setError(d.message || d.error || "구조화 실패")
        return
      }
      setResult(d.extraction as PaperExtraction)
      setMeta({ duration_ms: d.duration_ms, cost_usd: d.cost_usd })
    } catch {
      setError("네트워크 오류")
    } finally {
      setBusy(false)
    }
  }

  function applyAndClose() {
    if (!result) return
    onApply(result)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="bg-[#0a0c14] border border-cyan-500/30 rounded-2xl p-4 w-full max-w-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-sm font-semibold">💬 텍스트 정답 입력</div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              종이장부를 채팅처럼 적으면 NOX 가 자동 인식합니다.
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 text-sm">✕</button>
        </div>

        {error && (
          <div className="mb-3 p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-xs">
            {error}
          </div>
        )}

        <div className="space-y-3">
          {/* 입력 */}
          <div>
            <div className="text-[11px] text-slate-400 mb-1.5">
              자유 형식 (방번호 → 손님/인원 → 양주 → 줄돈 → 호스티스 라인)
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={PLACEHOLDERS[sheet_kind] ?? PLACEHOLDERS.rooms}
              rows={12}
              className="w-full bg-white/5 border border-white/10 rounded-lg p-3 text-sm placeholder-slate-500 outline-none focus:border-cyan-500/50 font-mono"
              disabled={busy}
            />
            <div className="flex items-center justify-between mt-1">
              <span className="text-[10px] text-slate-500">{text.length} / 8000</span>
              <button
                onClick={runParse}
                disabled={busy || text.trim().length < 5}
                className="text-xs px-3 py-1.5 rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 disabled:opacity-50"
              >
                {busy ? "분석 중..." : "🤖 AI 로 구조화"}
              </button>
            </div>
          </div>

          {/* 결과 */}
          {result && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold text-emerald-300">✓ 구조화 완료</div>
                {meta && (
                  <div className="text-[10px] text-slate-500">
                    {meta.duration_ms}ms · ${meta.cost_usd?.toFixed(4) ?? "0"}
                  </div>
                )}
              </div>
              <ResultSummary extraction={result} sheet_kind={sheet_kind} />
              <details className="rounded-lg border border-white/5 bg-black/30 p-2">
                <summary className="text-[10px] text-slate-400 cursor-pointer">
                  raw JSON (디버그)
                </summary>
                <pre className="text-[10px] text-slate-300 mt-2 overflow-x-auto">
                  {JSON.stringify(result, null, 2)}
                </pre>
              </details>
              <button
                onClick={applyAndClose}
                className="w-full py-2.5 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-200 text-sm font-semibold"
              >
                에디터에 적용
              </button>
              <div className="text-[10px] text-slate-500 text-center">
                적용 후 에디터에서 검수 + 저장하면 학습 데이터 자동 누적됩니다.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Result summary ─────────────────────────────────────────

function ResultSummary({
  extraction,
  sheet_kind,
}: {
  extraction: PaperExtraction
  sheet_kind: "rooms" | "staff" | "other"
}) {
  if (sheet_kind === "rooms") {
    const rooms = extraction.rooms ?? []
    const owe = extraction.daily_summary?.owe ?? []
    const recv = extraction.daily_summary?.recv ?? []
    return (
      <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3 text-xs space-y-2">
        <div className="text-slate-300">
          <span className="text-cyan-300">{rooms.length}</span> 룸 ·
          <span className="text-cyan-300 ml-1">
            {rooms.reduce((s, r) => s + (r.staff_entries?.length ?? 0), 0)}
          </span>{" "}
          호스티스 ·
          <span className="text-cyan-300 ml-1">
            {rooms.reduce((s, r) => s + (r.liquor?.length ?? 0), 0)}
          </span>{" "}
          양주
        </div>
        {owe.length > 0 && (
          <div className="text-slate-400">
            줄돈: {owe.map((o) => `${o.store_name} ${o.amount_won.toLocaleString()}`).join(" / ")}
          </div>
        )}
        {recv.length > 0 && (
          <div className="text-slate-400">
            받돈: {recv.map((r) => `${r.store_name} ${r.amount_won.toLocaleString()}`).join(" / ")}
          </div>
        )}
      </div>
    )
  }
  if (sheet_kind === "staff") {
    const staff = extraction.staff ?? []
    return (
      <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3 text-xs space-y-1">
        <div className="text-slate-300">
          <span className="text-cyan-300">{staff.length}</span> 스태프 ·
          <span className="text-cyan-300 ml-1">
            {staff.reduce((s, h) => s + (h.sessions?.length ?? 0), 0)}
          </span>{" "}
          세션
        </div>
        {staff.slice(0, 5).map((h, i) => (
          <div key={i} className="text-slate-400">
            {h.hostess_name} · {h.sessions?.length ?? 0}회
          </div>
        ))}
        {staff.length > 5 && (
          <div className="text-slate-500">… 외 {staff.length - 5}명</div>
        )}
      </div>
    )
  }
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3 text-xs text-slate-400">
      구조화 완료. JSON 확인.
    </div>
  )
}
