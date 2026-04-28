"use client"

/**
 * 사이드바 메뉴 드래그-리오더.
 *
 * UX:
 *   - 각 메뉴 우측 ≡ 핸들. 핸들을 꾹 누른 채 드래그 → 위치 변경 → 손 떼면 저장.
 *   - 모바일/데스크톱 통합 (Pointer Events). 250ms long-press 후 드래그 활성.
 *   - 드래그 중 다른 항목은 현재 커서 위치 기준 자동 슬롯 이동 표시.
 *   - 핸들이 아닌 본체 클릭은 기존 네비게이션.
 *
 * 저장: onReorder(newIdsInVisibleOrder) — 호출자가 user prefs 에 persist.
 */

import { useCallback, useRef, useState } from "react"
import type { MenuItemDefinition } from "@/lib/counter/menu"

type Props = {
  items: MenuItemDefinition[]
  activePath: string
  badgeFor: (m: MenuItemDefinition) => { count: number; dot: boolean }
  onItemClick: (m: MenuItemDefinition) => void
  onReorder: (newOrderIds: string[]) => void
}

// 250→120ms — 사용자가 안 됨으로 판단하는 시간을 줄임. 그래도 일반 tap 과 구분.
const LONG_PRESS_MS = 120

export default function ReorderableMenuList({
  items, activePath, badgeFor, onItemClick, onReorder,
}: Props) {
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  // 누르는 중인 핸들 idx (시각 피드백) — drag 시작 전 사용자에게 "누르는 중" 알림
  const [pressingIdx, setPressingIdx] = useState<number | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startedAt = useRef<number>(0)

  const cancelPress = useCallback(() => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current)
      pressTimerRef.current = null
    }
    setPressingIdx(null)
  }, [])

  const beginDrag = useCallback((idx: number, ev: React.PointerEvent<HTMLButtonElement>) => {
    ev.preventDefault()
    cancelPress()
    startedAt.current = Date.now()
    setPressingIdx(idx)  // 즉시 시각 피드백 — 사용자에게 "누르는 중" 알림
    pressTimerRef.current = setTimeout(() => {
      setDraggingIdx(idx)
      setHoverIdx(idx)
      setPressingIdx(null)
      // 드래그 시작 시 진동 피드백 (모바일).
      try { (navigator as Navigator & { vibrate?: (ms: number) => void }).vibrate?.(20) } catch { /* noop */ }
      // pointer capture — 핸들 밖으로 나가도 이벤트 유지
      try { (ev.target as HTMLElement).setPointerCapture(ev.pointerId) } catch { /* noop */ }
    }, LONG_PRESS_MS)
  }, [cancelPress])

  const onPointerMove = useCallback((ev: React.PointerEvent) => {
    if (draggingIdx === null) return
    const root = containerRef.current
    if (!root) return
    // 현재 커서가 닿는 메뉴 row 의 인덱스 계산
    const children = Array.from(root.querySelectorAll<HTMLElement>("[data-menu-row]"))
    for (let i = 0; i < children.length; i++) {
      const r = children[i].getBoundingClientRect()
      if (ev.clientY >= r.top && ev.clientY <= r.bottom) {
        if (hoverIdx !== i) setHoverIdx(i)
        return
      }
    }
  }, [draggingIdx, hoverIdx])

  const finishDrag = useCallback(() => {
    cancelPress()
    if (draggingIdx === null || hoverIdx === null || draggingIdx === hoverIdx) {
      setDraggingIdx(null); setHoverIdx(null); return
    }
    const newOrder = items.map(m => m.id) as string[]
    const [moved] = newOrder.splice(draggingIdx, 1)
    newOrder.splice(hoverIdx, 0, moved)
    setDraggingIdx(null); setHoverIdx(null)
    onReorder(newOrder)
  }, [draggingIdx, hoverIdx, items, onReorder, cancelPress])

  const onPointerUp = useCallback(() => { finishDrag() }, [finishDrag])
  const onPointerCancel = useCallback(() => {
    cancelPress()
    setDraggingIdx(null); setHoverIdx(null)
  }, [cancelPress])

  // hoverIdx 가 dragging 중일 때 이동 후 인덱스 — 시각적 표현용
  function visualIndex(originalIdx: number): number {
    if (draggingIdx === null || hoverIdx === null) return originalIdx
    if (originalIdx === draggingIdx) return hoverIdx
    // dragged 가 빠지고 hover 위치에 들어간 가상 배열에서 자기 위치
    if (draggingIdx < hoverIdx) {
      // dragged 가 위 → 아래로 이동: 그 사이 항목들은 한 칸 위로
      if (originalIdx > draggingIdx && originalIdx <= hoverIdx) return originalIdx - 1
    } else {
      // dragged 가 아래 → 위로 이동: 그 사이 항목들은 한 칸 아래로
      if (originalIdx >= hoverIdx && originalIdx < draggingIdx) return originalIdx + 1
    }
    return originalIdx
  }

  return (
    <div
      ref={containerRef}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      className="touch-none"
    >
      {items.map((m, idx) => {
        const active = m.path === activePath
        const { count, dot } = badgeFor(m)
        const isDragging = draggingIdx === idx
        const vi = visualIndex(idx)

        return (
          <div
            key={m.id}
            data-menu-row
            data-idx={idx}
            style={{
              transform: draggingIdx !== null && !isDragging
                ? `translateY(${(vi - idx) * 44}px)`
                : undefined,
              transition: isDragging ? "none" : "transform 120ms ease-out",
            }}
            className={`relative ${isDragging ? "opacity-40 scale-[0.98]" : ""}`}
          >
            <div className={`flex items-center gap-1 mb-1 ${isDragging ? "ring-1 ring-cyan-400/40 rounded-lg" : ""}`}>
              {/* 본체 — 클릭하면 네비 */}
              <button
                onClick={() => { if (draggingIdx === null) onItemClick(m) }}
                className={`flex-1 flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm ${active ? "bg-cyan-500/15 text-cyan-300" : "text-slate-400 hover:bg-white/5"}`}
              >
                <span className="text-base relative">
                  {m.icon}
                  {dot && (
                    <span className="absolute -top-0.5 -right-1 w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                  )}
                </span>
                <span className="flex-1 text-left">{m.label}</span>
                {count > 0 && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-500/25 text-red-300 border border-red-500/40">
                    {count > 99 ? "99+" : count}
                  </span>
                )}
              </button>

              {/* 드래그 핸들 — 꾹 눌러서 이동. UX: 항상 cyan, 크기 ↑, press 시 강조 */}
              <button
                type="button"
                aria-label="순서 변경 — 꾹 눌러서 드래그"
                onPointerDown={(ev) => beginDrag(idx, ev)}
                onPointerUp={() => cancelPress()}
                onPointerLeave={() => cancelPress()}
                onContextMenu={(e) => e.preventDefault()}
                className={`
                  flex items-center justify-center
                  w-10 h-10 rounded-lg
                  cursor-grab active:cursor-grabbing select-none touch-none
                  transition-all duration-100
                  ${pressingIdx === idx
                    ? "bg-cyan-500/30 text-cyan-200 scale-110 ring-2 ring-cyan-400"
                    : isDragging
                      ? "bg-cyan-500/40 text-cyan-100"
                      : "bg-white/[0.06] text-cyan-400/90 hover:bg-cyan-500/15 hover:text-cyan-300"}
                `}
                style={{ touchAction: "none" }}
                title="꾹 누른 채로 드래그하면 순서 변경"
              >
                <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor" aria-hidden>
                  <rect x="3" y="4" width="12" height="2" rx="0.7" />
                  <rect x="3" y="8" width="12" height="2" rx="0.7" />
                  <rect x="3" y="12" width="12" height="2" rx="0.7" />
                </svg>
              </button>
            </div>
          </div>
        )
      })}

      {draggingIdx !== null && (
        <div className="mt-2 text-[11px] text-cyan-300 text-center font-semibold animate-pulse">
          ↕ 드래그해서 위치 이동 — 손 떼면 저장
        </div>
      )}
      {pressingIdx !== null && draggingIdx === null && (
        <div className="mt-2 text-[10px] text-cyan-400/70 text-center">
          ⏳ 누르는 중… 그대로 잡고 있으세요
        </div>
      )}
    </div>
  )
}
