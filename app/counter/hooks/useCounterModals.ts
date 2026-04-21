"use client"

/**
 * useCounterModals — CounterPageV2에 흩어져 있던 modal/sheet state를 모은
 * 단일 훅. 동작 변경 없음 — 기존 state key/초기값/patch 세맨틱 그대로.
 *
 * 관리 대상 (5개):
 *   - sheet              : ParticipantSetupSheetV2 state (SheetState)
 *   - mgr                : ManagerChangeModalV2 state (MgrModalState)
 *   - bulkMgr            : BulkManagerPickerV2 state
 *   - inlineEdit         : ParticipantInlineEditor state
 *   - customerModalOpen  : CustomerModal 노출 플래그
 *
 * (inventoryModal 은 현재 CounterPageV2에 해당 토글이 없어 본 훅에서 관리
 *  안 함. 필요 시 후속 라운드에서 추가.)
 *
 * 각 state는 객체 전체 / patcher / reset 제공. 저장/리프레시 같은 비즈니스
 * 로직은 여기에 넣지 않는다 — useParticipantEditFlow 책임.
 */

import { useState, type Dispatch, type SetStateAction } from "react"
import {
  SHEET_INIT,
  MGR_MODAL_INIT,
  type SheetState,
  type MgrModalState,
  type StaffItem,
} from "../types"
import type { InlineEditMode } from "../components/ParticipantInlineEditor"

export type BulkMgrState = {
  open: boolean
  storeName: string
  storeUuid: string | null
  managerList: StaffItem[]
  participantIds: string[]
  roomId: string | null
  sessionId: string | null
  busy: boolean
}

export const BULK_MGR_INIT: BulkMgrState = {
  open: false,
  storeName: "",
  storeUuid: null,
  managerList: [],
  participantIds: [],
  roomId: null,
  sessionId: null,
  busy: false,
}

export type InlineEditState = {
  mode: InlineEditMode
  participantId: string
  busy: boolean
} | null

export type CounterModals = {
  // sheet
  sheet: SheetState
  setSheet: Dispatch<SetStateAction<SheetState>>
  patchSheet: (p: Partial<SheetState>) => void
  resetSheet: () => void

  // manager change modal
  mgr: MgrModalState
  setMgr: Dispatch<SetStateAction<MgrModalState>>
  patchMgr: (p: Partial<MgrModalState>) => void
  resetMgr: () => void

  // bulk manager picker
  bulkMgr: BulkMgrState
  setBulkMgr: Dispatch<SetStateAction<BulkMgrState>>
  resetBulkMgr: () => void

  // inline editor
  inlineEdit: InlineEditState
  setInlineEdit: Dispatch<SetStateAction<InlineEditState>>

  // customer modal
  customerModalOpen: boolean
  setCustomerModalOpen: Dispatch<SetStateAction<boolean>>
}

export function useCounterModals(): CounterModals {
  const [sheet, setSheet] = useState<SheetState>(SHEET_INIT)
  const patchSheet = (p: Partial<SheetState>) => setSheet(s => ({ ...s, ...p }))
  const resetSheet = () => setSheet(SHEET_INIT)

  const [mgr, setMgr] = useState<MgrModalState>(MGR_MODAL_INIT)
  const patchMgr = (p: Partial<MgrModalState>) => setMgr(s => ({ ...s, ...p }))
  const resetMgr = () => setMgr(MGR_MODAL_INIT)

  const [bulkMgr, setBulkMgr] = useState<BulkMgrState>(BULK_MGR_INIT)
  const resetBulkMgr = () => setBulkMgr(BULK_MGR_INIT)

  const [inlineEdit, setInlineEdit] = useState<InlineEditState>(null)

  const [customerModalOpen, setCustomerModalOpen] = useState(false)

  return {
    sheet, setSheet, patchSheet, resetSheet,
    mgr, setMgr, patchMgr, resetMgr,
    bulkMgr, setBulkMgr, resetBulkMgr,
    inlineEdit, setInlineEdit,
    customerModalOpen, setCustomerModalOpen,
  }
}
