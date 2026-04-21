"use client"

/**
 * DragReorderList — Phase D. HTML5 draggable 기반 공용 재배열 리스트.
 *
 * dep 없이 순수 native drag API 사용. 각 row 는 `draggable` 이고,
 * onDragStart 에서 index 를 기록, onDragOver 에서 preventDefault,
 * onDrop 에서 `onReorder(from, to)` 호출. 터치 환경에서는 native
 * drag 가 제한적이므로 "위/아래" 버튼이 함께 렌더된다 (핀치-폰 운영
 * 단말 대응).
 */

import { useRef, useState, type ReactNode } from "react"

export type DragRowItem = {
  id: string
  content: ReactNode
  /** 잠금 표시 — 사용자가 재배열/숨김 못 함. 시각적 구분. */
  locked?: boolean
}

type Props = {
  items: DragRowItem[]
  onReorder: (fromIndex: number, toIndex: number) => void
}

export default function DragReorderList({ items, onReorder }: Props) {
  const dragIndex = useRef<number | null>(null)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)

  const move = (from: number, to: number) => {
    if (from === to) return
    if (to < 0 || to >= items.length) return
    onReorder(from, to)
  }

  return (
    <ul className="flex flex-col gap-1">
      {items.map((it, idx) => (
        <li
          key={it.id}
          draggable={!it.locked}
          onDragStart={e => {
            if (it.locked) { e.preventDefault(); return }
            dragIndex.current = idx
            e.dataTransfer.effectAllowed = "move"
          }}
          onDragOver={e => {
            if (dragIndex.current == null) return
            e.preventDefault()
            e.dataTransfer.dropEffect = "move"
            setHoverIndex(idx)
          }}
          onDragLeave={() => setHoverIndex(cur => (cur === idx ? null : cur))}
          onDrop={e => {
            e.preventDefault()
            const from = dragIndex.current
            dragIndex.current = null
            setHoverIndex(null)
            if (from == null) return
            move(from, idx)
          }}
          onDragEnd={() => { dragIndex.current = null; setHoverIndex(null) }}
          className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 transition-colors ${
            it.locked
              ? "border-white/[0.06] bg-white/[0.02] opacity-80"
              : "border-white/10 bg-white/[0.04] hover:bg-white/[0.06]"
          } ${hoverIndex === idx ? "ring-1 ring-cyan-400/50" : ""}`}
        >
          <span className={`text-slate-500 text-sm select-none ${it.locked ? "" : "cursor-grab active:cursor-grabbing"}`} title={it.locked ? "잠김 — 재배열 불가" : "드래그해서 순서 변경"}>
            {it.locked ? "🔒" : "⋮⋮"}
          </span>
          <div className="flex-1 min-w-0">{it.content}</div>
          <div className="flex items-center gap-0.5 flex-shrink-0">
            <button
              type="button"
              onClick={() => move(idx, idx - 1)}
              disabled={it.locked || idx === 0}
              className="w-6 h-6 rounded text-xs text-slate-400 hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent"
              title="위로"
            >↑</button>
            <button
              type="button"
              onClick={() => move(idx, idx + 1)}
              disabled={it.locked || idx === items.length - 1}
              className="w-6 h-6 rounded text-xs text-slate-400 hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent"
              title="아래로"
            >↓</button>
          </div>
        </li>
      ))}
    </ul>
  )
}
