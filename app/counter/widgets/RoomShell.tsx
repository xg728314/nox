"use client"

/**
 * RoomShell — Phase A scaffold.
 *
 * 기존 RoomCardV2 의 최외곽 wrapper 를 복제한다:
 *   - isActive → 붉은 tint + 붉은 border
 *   - isFocused → cyan ring
 *
 * Provider 로 children (widget renderer 혹은 기타) 을 감싸서
 * `useRoomContext()` 가 동작하도록 한다.
 *
 * Phase A 에서는 아직 RoomCardV2 를 교체하지 않는다 — 이 컴포넌트는
 * 위젯 구조 검증용 scaffold 이다.
 */

import type { ReactNode } from "react"
import { RoomProvider, type RoomContextInputs } from "./RoomContext"

export type RoomShellProps = {
  value: RoomContextInputs
  children: ReactNode
}

export default function RoomShell({ value, children }: RoomShellProps) {
  const isActive = value.room.session?.status === "active"
  const { isFocused } = value
  return (
    <div
      className={`rounded-2xl border overflow-hidden transition-all ${
        isActive
          ? "border-red-500/30 bg-red-500/[0.06]"
          : "border-white/[0.08] bg-white/[0.03]"
      } ${isFocused ? "ring-2 ring-cyan-500/40" : ""}`}
    >
      <RoomProvider value={value}>{children}</RoomProvider>
    </div>
  )
}
