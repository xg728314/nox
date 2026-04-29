"use client"

/**
 * KeyboardHelpOverlay — modal listing all keyboard shortcuts and a brief
 * legend of how to read the graph. Triggered by the `?` key.
 *
 * Closes on `Esc`, click on the backdrop, or the `?` key again. Pure
 * presentation — no data fetch.
 */

import { useEffect } from "react"

type Props = {
  open: boolean
  onClose: () => void
}

const SHORTCUTS: ReadonlyArray<{ keys: string; label: string }> = [
  { keys: "b", label: "빌딩 전체 보기" },
  { keys: "s", label: "단일 매장 보기" },
  { keys: "1 / 2 / 3 / 4 / 5", label: "시간 범위 (오늘 / 어제 / 7일 / 이번달 / 직접지정)" },
  { keys: "p", label: "참여 엣지 숨김 토글" },
  { keys: "u", label: "이름 unmask 토글 (audit 기록됨)" },
  { keys: "e", label: "활동 없는 매장 숨김 토글" },
  { keys: "f", label: "전체 보기 (그래프 줌 리셋)" },
  { keys: "r", label: "수동 새로고침" },
  { keys: "?", label: "이 도움말" },
  { keys: "Esc", label: "선택 / 도움말 닫기" },
]

const READ_GUIDE: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: "노드 색",
    body: "범례 (우상단 '범례') 참고. 매장은 amber, 실장 violet, 호스티스 cyan, 세션 blue, 정산 pink, 지급 green, 감사 slate.",
  },
  {
    title: "엣지 두께",
    body: "stored 금액 또는 활동 빈도 가중치. 굵을수록 큰 흐름.",
  },
  {
    title: "점선 / 빨강",
    body: "점선 = cross-store / 위험. 빨간 발광 = risk (지급 반환·취소, 강제 변경).",
  },
  {
    title: "회색 dim",
    body: "오늘 활동 없는 매장은 30% 어둡게 표시. 'e' 키로 완전 숨김 가능.",
  },
  {
    title: "stored vs 계산값",
    body: "모든 값은 DB 저장값 그대로 — 정산/지급 logic 재계산 없음.",
  },
  {
    title: "PII 마스킹",
    body: "기본 마스킹. super_admin 만 'u' 키로 unmask 가능. unmask 시 audit_events 에 자동 기록됨.",
  },
  {
    title: "갱신 주기",
    body: "30초마다 자동 폴링. 'as of' 배지가 stale 검출. 노드 위치는 폴링 시 유지됨.",
  },
]

export default function KeyboardHelpOverlay({ open, onClose }: Props) {
  // Close on Esc.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label="네트워크 맵 도움말"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[88vh] overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sticky top-0 bg-slate-900 px-5 py-3 border-b border-slate-800 flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-slate-500">도움말</div>
            <h2 className="text-sm font-semibold text-slate-100">
              Jarvis 네트워크 맵 · 단축키와 읽는 법
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="text-slate-400 hover:text-slate-100 px-2 py-0.5"
          >
            ✕
          </button>
        </header>

        <div className="grid md:grid-cols-2 gap-4 p-5 text-[12px] text-slate-300">
          {/* Shortcuts */}
          <section>
            <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-2">
              단축키
            </div>
            <ul className="space-y-1.5">
              {SHORTCUTS.map((s) => (
                <li key={s.keys} className="flex items-start gap-3">
                  <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-200 font-mono whitespace-nowrap shrink-0">
                    {s.keys}
                  </kbd>
                  <span className="text-slate-300">{s.label}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 text-[10px] text-slate-500">
              입력창 / 선택창에 포커스가 있으면 단축키는 무시됩니다.
            </div>
          </section>

          {/* Read guide */}
          <section>
            <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-2">
              읽는 법
            </div>
            <dl className="space-y-2">
              {READ_GUIDE.map((g) => (
                <div key={g.title}>
                  <dt className="text-[11px] text-slate-200 font-medium">{g.title}</dt>
                  <dd className="text-[11px] text-slate-400 mt-0.5">{g.body}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>

        <footer className="px-5 py-2 border-t border-slate-800 text-[10px] text-slate-500">
          <kbd className="text-[10px] px-1 py-0 rounded bg-slate-800 border border-slate-700">Esc</kbd>{" "}
          또는 배경 클릭으로 닫기
        </footer>
      </div>
    </div>
  )
}
