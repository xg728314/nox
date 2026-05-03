"use client"

/**
 * R29-refactor: BulkManagerPickerV2 의 open / close 흐름.
 *   RoomCardV2 에서 다인 staff-chat 입력 후 매장이 정확히 하나로 resolve 되면
 *   호출. 같은 실장을 N명 참여자에 일괄 적용.
 *
 *   bulkAssignManager 자체는 useParticipantEditFlow 가 소유 — 여기는 modal
 *   상태만 관리.
 */

import * as counterApi from "../services/counterApi"
import { BULK_MGR_INIT, type BulkMgrState } from "./useCounterModals"
import type { Dispatch, SetStateAction } from "react"

export type UseBulkManagerPickerDeps = {
  bulkMgr: BulkMgrState
  setBulkMgr: Dispatch<SetStateAction<BulkMgrState>>
}

export function useBulkManagerPicker(deps: UseBulkManagerPickerDeps) {
  async function openBulkManagerPicker(args: {
    roomId: string
    sessionId: string | null
    storeName: string
    /** 2026-05-03 R-Privacy: 매장 한글명 URL 노출 제거 — uuid 가 있으면 그걸로 fetch. */
    storeUuid?: string | null
    participantIds: string[]
  }) {
    if (!args.storeName || args.participantIds.length === 0) return
    deps.setBulkMgr({
      open: true,
      storeName: args.storeName,
      storeUuid: args.storeUuid ?? null,
      managerList: [],
      participantIds: args.participantIds,
      roomId: args.roomId,
      sessionId: args.sessionId,
      busy: false,
    })
    try {
      // uuid 있으면 그 경로 (URL log 에 매장명 안 남음). 없으면 fallback.
      const { staff, store_uuid } = args.storeUuid
        ? await counterApi.fetchManagersForStoreUuid(args.storeUuid)
        : await counterApi.fetchManagersForStore(args.storeName)
      deps.setBulkMgr(s => ({ ...s, managerList: staff, storeUuid: store_uuid }))
    } catch {
      // managerList 빈 상태로 둠 — UI 가 처리.
    }
  }

  function closeBulkManagerPicker() {
    if (deps.bulkMgr.busy) return
    deps.setBulkMgr(BULK_MGR_INIT)
  }

  return { openBulkManagerPicker, closeBulkManagerPicker }
}
