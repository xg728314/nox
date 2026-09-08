"use client"
/**
 * ChatRulesBanner — 채팅방 상단 핀 고정 규칙 배너
 *
 * R36 (2026-09-09): 카톡 → NOX chat 이관 · 규칙 상시 노출.
 *   접기/펴기 가능 · 최초 진입 시 펼침 · localStorage 로 상태 저장.
 *   owner 만 「규칙 편집」 버튼 노출.
 */
import { useEffect, useState } from "react"
import Link from "next/link"

type Props = {
  storeName?: string
  rules?: {
    prefix_required?: boolean
    examples?: string[]
    events?: string[]
  } | null
  isOwner?: boolean
}

const DEFAULT_EVENTS = ["메·메이드·스타트 (시작)", "완메·반메 (완료)", "끝·팅·감을께 (종료)", "1연·2연·연장 (연장)", "초이스있어요 (초이스 진행)", "대기부탁드립니다 (대기 요청)"]

export function ChatRulesBanner({ storeName = "우리 매장", rules, isOwner }: Props) {
  const [expanded, setExpanded] = useState(true)
  useEffect(() => {
    try {
      const stored = localStorage.getItem("nox.chat_rules_expanded")
      if (stored === "0") setExpanded(false)
    } catch { /* noop */ }
  }, [])
  useEffect(() => {
    try { localStorage.setItem("nox.chat_rules_expanded", expanded ? "1" : "0") } catch { /* noop */ }
  }, [expanded])

  const examples = rules?.examples ?? [
    `「${storeName} 지연 셔츠 완메」`,
    `「${storeName} 3번방 유나 하퍼 스타트」`,
    `「${storeName} 다은 반차3 끝」`,
  ]
  const events = rules?.events ?? DEFAULT_EVENTS
  const prefixRequired = rules?.prefix_required !== false

  return (
    <div className="sticky top-0 z-30 bg-gradient-to-b from-[#FAF5EC] to-[#FAF5EC]/95 backdrop-blur border-b border-[#EDE7DA] shadow-sm">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-2 px-4 py-2 text-left"
      >
        <span className="text-[14px]">📌</span>
        <span className="text-[11px] font-black text-[#8C6A3A] uppercase tracking-wider">
          {storeName} 채팅 규칙
        </span>
        {!expanded && (
          <span className="text-[10px] font-bold text-[#7A746A] truncate">
            · 「매장 아가씨 종목 이벤트」 · 예: 「{storeName} 지연 셔츠 완메」
          </span>
        )}
        <span className={`ml-auto text-[11px] text-[#7A746A] transition-transform ${expanded ? "rotate-180" : ""}`}>▾</span>
      </button>
      {expanded && (
        <div className="px-4 pb-3 space-y-2">
          <div className="rounded-xl bg-white border border-[#EDE7DA] p-3 space-y-2">
            <div className="text-[11px] font-black text-[#2D2B26]">✍ 형식</div>
            <div className="text-[11px] font-bold text-[#7A746A] leading-relaxed">
              {prefixRequired && (
                <>① <b className="text-[#8C6A3A]">매장 접두 필수</b> — 예: {storeName}, 마블, 라이브 등<br /></>
              )}
              ② <b className="text-[#8C6A3A]">아가씨 이름 필수</b> (여러 명 콤마 or 공백)<br />
              ③ <b className="text-[#8C6A3A]">종목</b>: 퍼블릭·셔츠·하퍼 (「퍼·셔·하」 축약 OK)<br />
              ④ <b className="text-[#8C6A3A]">이벤트</b>: 다음 중 하나
            </div>
            <ul className="text-[10px] font-bold text-[#7A746A] pl-3 space-y-0.5 list-disc">
              {events.map(e => <li key={e}>{e}</li>)}
            </ul>
          </div>
          <div className="rounded-xl bg-[#C49B61]/10 border border-[#C49B61]/30 p-3">
            <div className="text-[11px] font-black text-[#8C6A3A] mb-1">📝 예시 (자동 등록 100%)</div>
            <div className="text-[11px] font-mono text-[#2D2B26] space-y-0.5">
              {examples.map(e => <div key={e}>{e}</div>)}
            </div>
          </div>
          <div className="text-[10px] font-bold text-[#7A746A] text-center leading-relaxed">
            ⚠ 형식 틀려도 봇이 정중히 안내합니다. 편하게 쓰세요.
          </div>
          {isOwner && (
            <div className="pt-1 border-t border-[#EDE7DA] flex items-center justify-between">
              <Link
                href="/m/store/settings/chat-parser"
                className="text-[10px] font-bold text-[#8C6A3A] underline"
              >
                ⚙ 규칙 편집 · 봇 엄격도
              </Link>
              <span className="text-[9px] text-[#7A746A]">사장 전용</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
