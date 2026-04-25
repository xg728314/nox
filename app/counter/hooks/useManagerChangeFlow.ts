"use client"

/**
 * R29-refactor: "실장 변경" 모달 흐름.
 *   ManagerChangeModalV2 가 사용. internal manager 선택 또는 external manager
 *   직접 입력 → 세션 patch.
 */

import * as counterApi from "../services/counterApi"
import { MGR_MODAL_INIT, type MgrModalState } from "../types"
import type { useFocusedSession } from "./useFocusedSession"

type FocusData = ReturnType<typeof useFocusedSession>["focusData"]

export type UseManagerChangeFlowDeps = {
  focusData: FocusData
  mgr: MgrModalState
  setMgr: (s: MgrModalState) => void
  patchMgr: (patch: Partial<MgrModalState>) => void
  ensureSession: (roomId: string) => Promise<string | null>
  fetchRooms: () => Promise<void>
  setBusy: (b: boolean) => void
  setError: (s: string) => void
}

export function useManagerChangeFlow(deps: UseManagerChangeFlowDeps) {
  async function openMgrModal() {
    try {
      const { staff } = await counterApi.fetchManagersForStore(null)
      deps.patchMgr({ open: true, staffList: staff })
    } catch {
      deps.patchMgr({ open: true })
    }
  }

  async function handleSaveManager() {
    if (!deps.focusData) return
    const body: Record<string, unknown> = {}
    if (deps.mgr.isExternal) {
      if (!deps.mgr.externalName.trim()) {
        deps.setError("실장 이름을 입력하세요")
        return
      }
      body.is_external_manager = true
      body.manager_name = deps.mgr.externalOrg.trim()
        ? `${deps.mgr.externalOrg.trim()} ${deps.mgr.externalName.trim()}`
        : deps.mgr.externalName.trim()
      body.manager_membership_id = null
    } else if (deps.mgr.selected) {
      body.is_external_manager = false
      body.manager_name = deps.mgr.selected.name
      body.manager_membership_id = deps.mgr.selected.membership_id
    } else {
      deps.setError("실장을 선택하세요")
      return
    }
    deps.setBusy(true)
    try {
      const sessionId = await deps.ensureSession(deps.focusData.roomId)
      if (!sessionId) return
      const result = await counterApi.patchSession(sessionId, body)
      if (!result.ok) {
        const d = result.data as { message?: string }
        deps.setError(d?.message || "실장 변경 실패")
        return
      }
      deps.setMgr(MGR_MODAL_INIT)
      await deps.fetchRooms()
    } catch {
      deps.setError("요청 오류")
    } finally {
      deps.setBusy(false)
    }
  }

  return { openMgrModal, handleSaveManager }
}
