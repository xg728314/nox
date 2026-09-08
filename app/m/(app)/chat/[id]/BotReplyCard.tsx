"use client"
/**
 * BotReplyCard — 채팅 메시지 아래 접히는 봇 답장 카드 (thread reply).
 *
 * R36 (2026-09-09): 3가지 패턴 (understand_confirm / partial_missing / template_suggest).
 *
 * Props:
 *   - payload: BotReplyPayload (composer.ts)
 *   - onConfirm / onEdit / onIgnore / onSelectCandidate / onRefillTemplate 콜백
 *
 * Compressed 모드 (피크시간): 축약 pill 만 표시 · 클릭 시 상세 펼침.
 */
import { useEffect, useState } from "react"

type UnderstandField = { label: string; value: string }
type UnderstandPayload = {
  pattern: "understand_confirm"
  title: string
  fields: UnderstandField[]
  actions: { confirm_label?: string; edit_label?: string; ignore_label?: string }
  auto_register_after_sec?: number
  dispatch_id?: string
  compressed?: boolean
}
type PartialPayload = {
  pattern: "partial_missing"
  title: string
  candidates?: Array<{ label: string; membership_id?: string; action?: string }>
  hint?: string
  hint_example?: string
  compressed?: boolean
}
type TemplatePayload = {
  pattern: "template_suggest"
  title: string
  template_lines: string[]
  refill_hint?: string
  refill_template?: string
  compressed?: boolean
}
export type BotPayload = UnderstandPayload | PartialPayload | TemplatePayload

export function BotReplyCard({
  payload,
  onConfirm,
  onEdit,
  onIgnore,
  onSelectCandidate,
  onRefillTemplate,
}: {
  payload: BotPayload
  onConfirm?: () => void
  onEdit?: () => void
  onIgnore?: () => void
  onSelectCandidate?: (label: string, membership_id?: string, action?: string) => void
  onRefillTemplate?: (template: string) => void
}) {
  const [expanded, setExpanded] = useState(!payload.compressed)
  const [autoLeft, setAutoLeft] = useState<number | null>(null)
  const [dismissed, setDismissed] = useState(false)

  // Pattern A · auto register countdown
  // R37-fix (Agent #2): deps 에 payload 객체 전체 넣으면 매 렌더마다 새 참조 → 타이머 무한 리셋
  //   → 3초 도달 못 함. primitive 만 dep 으로.
  const autoSecs = payload.pattern === "understand_confirm" ? payload.auto_register_after_sec : undefined
  const patternKind = payload.pattern
  useEffect(() => {
    if (patternKind !== "understand_confirm") return
    if (!autoSecs || autoSecs <= 0) return
    setAutoLeft(autoSecs)
    const timer = setInterval(() => {
      setAutoLeft(v => {
        if (v === null) return null
        if (v <= 1) {
          clearInterval(timer)
          if (!dismissed) onConfirm?.()
          return 0
        }
        return v - 1
      })
    }, 1000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patternKind, autoSecs])

  if (dismissed) return null

  // 압축 pill (피크시간)
  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="mt-1 ml-4 inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-300 px-3 py-1 text-[11px] font-black text-amber-900 active:bg-amber-100"
      >
        🤖 {payload.title.substring(0, 20)}{payload.title.length > 20 && "…"} <span className="text-[9px]">▾ 펼치기</span>
      </button>
    )
  }

  return (
    <div className="mt-1 ml-4 max-w-[92%] rounded-2xl border-2 border-[#A87D45]/40 bg-white shadow-sm overflow-hidden">
      {/* Bot header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-[#FAF5EC] to-[#F5F0E5] border-b border-[#EDE7DA]">
        <span className="text-[14px]">🤖</span>
        <span className="text-[10px] font-black text-[#8C6A3A] uppercase tracking-wider">NOX</span>
        <span className="text-[12px] font-extrabold text-[#2D2B26] flex-1 truncate">{payload.title}</span>
        <button
          type="button"
          onClick={() => { setDismissed(true); onIgnore?.() }}
          className="text-[16px] text-[#7A746A] w-6 h-6 flex items-center justify-center active:opacity-60"
          aria-label="닫기"
        >
          ×
        </button>
      </div>

      {/* Body */}
      <div className="px-3 py-2.5 space-y-2">
        {/* Pattern A · understand_confirm */}
        {payload.pattern === "understand_confirm" && (
          <>
            <div className="rounded-lg bg-[#FAF5EC]/50 border border-[#EDE7DA] p-2 space-y-1">
              {payload.fields.map(f => (
                <div key={f.label} className="flex text-[11px]">
                  <span className="w-14 shrink-0 text-[10px] font-bold text-[#7A746A]">· {f.label}</span>
                  <span className="font-extrabold text-[#2D2B26]">{f.value}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setDismissed(true); onConfirm?.() }}
                className="flex-1 rounded-lg bg-green-600 py-2 text-[11px] font-extrabold text-white active:bg-green-700"
              >
                {payload.actions.confirm_label ?? "✓ 맞음"}
                {autoLeft !== null && autoLeft > 0 && ` (${autoLeft}s)`}
              </button>
              <button
                type="button"
                onClick={() => { setDismissed(true); onEdit?.() }}
                className="rounded-lg border-2 border-[#D8D2C8] bg-white px-3 py-2 text-[11px] font-extrabold text-[#7A746A] active:bg-[#F5F0E5]"
              >
                {payload.actions.edit_label ?? "✏ 수정"}
              </button>
            </div>
            {payload.auto_register_after_sec && autoLeft !== null && autoLeft > 0 && (
              <div className="text-[9px] font-bold text-[#7A746A] text-center">
                {autoLeft}초 후 자동 등록 · 취소하려면 「무시」
              </div>
            )}
          </>
        )}

        {/* Pattern B · partial_missing */}
        {payload.pattern === "partial_missing" && (
          <>
            {payload.candidates && payload.candidates.length > 0 && (
              <div className="space-y-1.5">
                {payload.candidates.map((c, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => { setDismissed(true); onSelectCandidate?.(c.label, c.membership_id, c.action) }}
                    className="w-full text-left rounded-lg border border-[#D8D2C8] bg-white px-3 py-2 text-[11px] font-extrabold text-[#2D2B26] active:bg-[#F5F0E5]"
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            )}
            {payload.hint && (
              <div className="rounded-lg bg-blue-50 border border-blue-200 p-2">
                <div className="text-[10px] font-bold text-blue-900">{payload.hint}</div>
                {payload.hint_example && (
                  <div className="text-[10px] font-mono text-blue-800 mt-0.5">{payload.hint_example}</div>
                )}
              </div>
            )}
          </>
        )}

        {/* Pattern C · template_suggest */}
        {payload.pattern === "template_suggest" && (
          <>
            <div className="rounded-lg bg-[#F5F0E5] border border-[#EDE7DA] p-2.5">
              {payload.template_lines.map((line, i) => (
                <div key={i} className={`text-[11px] ${line.trim().startsWith("[") || line.trim().startsWith("「") ? "font-mono font-extrabold text-[#8C6A3A]" : "font-bold text-[#7A746A]"} leading-relaxed`}>
                  {line || " "}
                </div>
              ))}
            </div>
            {payload.refill_template && (
              <button
                type="button"
                onClick={() => { setDismissed(true); onRefillTemplate?.(payload.refill_template!) }}
                className="w-full rounded-lg bg-[#C49B61] py-2 text-[11px] font-extrabold text-white active:bg-[#A87D45]"
              >
                📝 {payload.refill_hint ?? "이 형식으로 다시 쓰기"}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
