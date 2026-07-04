"use client"
import { useState } from "react"
import { apiFetch } from "@/lib/apiFetch"

/**
 * 🤖 오늘 요약 버튼 → 시트에 Claude 응답 표시.
 *   R-ai-summary (2026-06-28).
 */
export function AiSummaryButton() {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [summary, setSummary] = useState<string | null>(null)
  const [source, setSource] = useState<string>("")
  const [err, setErr] = useState<string | null>(null)

  async function loadSummary() {
    setLoading(true)
    setErr(null)
    try {
      const res = await apiFetch("/api/ai/summary")
      const j = await res.json()
      if (!res.ok) throw new Error(j?.message ?? `HTTP ${res.status}`)
      setSummary(j.summary)
      setSource(j.source)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true)
          if (!summary) loadSummary()
        }}
        className="w-full flex items-center justify-center gap-2 bg-gradient-to-br from-[#2D2B26] to-[#1a1813] text-[#E4C99A] rounded-2xl py-3 text-[13px] font-extrabold border border-[#C49B61]/30"
      >
        🤖 오늘 요약 (AI)
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-end"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full bg-white rounded-t-3xl p-5 max-w-[420px] mx-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="text-[16px] font-extrabold">🤖 오늘 요약</div>
              <button
                type="button"
                onClick={loadSummary}
                disabled={loading}
                className="text-[10px] font-extrabold text-[#A87D45] px-2 py-1 rounded-full border border-[#D8D2C8] disabled:opacity-40"
              >
                🔄 새로고침
              </button>
            </div>
            {loading && (
              <div className="py-8 text-center text-[12px] text-[#7A746A]">
                요약 생성 중...
              </div>
            )}
            {err && (
              <div className="text-red-600 text-[12px] py-4">{err}</div>
            )}
            {summary && !loading && (
              <>
                <div className="bg-[#FAF5EC] rounded-2xl p-4 text-[13px] leading-relaxed whitespace-pre-wrap">
                  {summary}
                </div>
                <div className="text-[9px] text-[#7A746A] text-center mt-2">
                  {source === "claude" ? "Claude Haiku" : "템플릿"} · 실시간 데이터
                </div>
              </>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="w-full bg-[#EFEBE3] rounded-2xl py-3 text-[13px] font-extrabold mt-3"
            >
              닫기
            </button>
          </div>
        </div>
      )}
    </>
  )
}
