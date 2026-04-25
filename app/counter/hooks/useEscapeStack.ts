"use client"

/**
 * R29-refactor: ESC 키 → 가장 위 layer 부터 차례로 닫기.
 *   순서: customer 모달 → manager 모달 → 시트 → 사이드바 → 포커스 종료.
 *   하나라도 처리하면 거기서 멈춤 (early return).
 */

import { useEffect } from "react"

export type UseEscapeStackDeps = {
  customerModalOpen: boolean
  closeCustomerModal: () => void
  mgrOpen: boolean
  closeMgrModal: () => void
  sheetOpen: boolean
  closeSheet: () => void
  sidebarOpen: boolean
  closeSidebar: () => void
  focusRoomId: string | null
  exitFocus: () => void
}

export function useEscapeStack(deps: UseEscapeStackDeps): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      if (deps.customerModalOpen) { deps.closeCustomerModal(); return }
      if (deps.mgrOpen) { deps.closeMgrModal(); return }
      if (deps.sheetOpen) { deps.closeSheet(); return }
      if (deps.sidebarOpen) { deps.closeSidebar(); return }
      if (deps.focusRoomId) { deps.exitFocus(); return }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
    // 의존성은 boolean / id 만 — handler 함수는 closure 로 캡처.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps.customerModalOpen, deps.mgrOpen, deps.sheetOpen, deps.sidebarOpen, deps.focusRoomId])
}
