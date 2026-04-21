"use client"

import { useCallback, useState, type Dispatch, type SetStateAction } from "react"
import { apiFetch } from "@/lib/apiFetch"
import type { FocusData, StaffItem } from "../types"

/**
 * useCreditFlow — owns the room-scoped credit (외상) input flow.
 *
 * Design decision (STEP-004):
 *   useCheckoutFlow already owns checkout + interim + closed-room entry + swipe.
 *   Adding credit input there would conflate "finalize session money" with "record
 *   an unpaid balance on this room". Credit is its own domain (pending receivable,
 *   manager-owned, customer-indexed) and has a different lifecycle from checkout.
 *   Per the ownership doc (rule 3.외상, "책임이 과도해지면 useCreditFlow를 새로
 *   만든다"), this is a new hook, not an extension of useCheckoutFlow.
 *
 * Responsibilities:
 *   - creditModalOpen state
 *   - creditForm (manager_membership_id / customer_name / phone / amount / memo)
 *   - managerList fetch (for the dropdown)
 *   - submit to POST /api/credits
 *   - post-submit room refresh
 *
 * Does NOT own:
 *   - checkout / interim flow (useCheckoutFlow)
 *   - focus session source of truth (useFocusedSession)
 *   - inventory / room list fetch
 */

type Deps = {
  focusData: FocusData | null
  fetchRooms: () => Promise<void>
  setError: Dispatch<SetStateAction<string>>
}

export type CreditFormState = {
  manager_membership_id: string
  customer_name: string
  customer_phone: string
  amount: string // kept as input string; parsed on submit
  memo: string
}

const INITIAL: CreditFormState = {
  manager_membership_id: "",
  customer_name: "",
  customer_phone: "",
  amount: "",
  memo: "",
}

type UseCreditFlowReturn = {
  creditModalOpen: boolean
  creditForm: CreditFormState
  managerList: StaffItem[]
  submitting: boolean
  openCreditModal: () => Promise<void>
  closeCreditModal: () => void
  updateCreditForm: (patch: Partial<CreditFormState>) => void
  submitCredit: () => Promise<void>
}

export function useCreditFlow(deps: Deps): UseCreditFlowReturn {
  const [creditModalOpen, setCreditModalOpen] = useState(false)
  const [creditForm, setCreditForm] = useState<CreditFormState>(INITIAL)
  const [managerList, setManagerList] = useState<StaffItem[]>([])
  const [submitting, setSubmitting] = useState(false)

  const openCreditModal = useCallback(async () => {
    if (!deps.focusData) { deps.setError("방을 선택하세요"); return }
    deps.setError("")
    setCreditForm(INITIAL)
    setCreditModalOpen(true)
    // Load managers for the current store so the user can pick one.
    // Non-blocking: modal opens immediately; dropdown fills when the fetch lands.
    try {
      const res = await apiFetch("/api/store/staff?role=manager")
      if (res.ok) {
        const d = await res.json()
        setManagerList((d.staff ?? []) as StaffItem[])
      }
    } catch { /* non-blocking; modal is still usable */ }
  }, [deps])

  const closeCreditModal = useCallback(() => {
    setCreditModalOpen(false)
  }, [])

  const updateCreditForm = useCallback((patch: Partial<CreditFormState>) => {
    setCreditForm(prev => ({ ...prev, ...patch }))
  }, [])

  const submitCredit = useCallback(async () => {
    const { focusData, fetchRooms, setError } = deps
    if (!focusData) { setError("방이 선택되지 않았습니다"); return }
    if (!creditForm.manager_membership_id) { setError("담당 실장을 선택하세요"); return }
    if (!creditForm.customer_name.trim()) { setError("손님 이름을 입력하세요"); return }
    const amountNum = Number(creditForm.amount)
    if (!Number.isFinite(amountNum) || amountNum <= 0) { setError("금액을 확인하세요"); return }
    setSubmitting(true); setError("")
    try {
      const body: Record<string, unknown> = {
        room_uuid: focusData.roomId,
        manager_membership_id: creditForm.manager_membership_id,
        customer_name: creditForm.customer_name.trim(),
        amount: amountNum,
      }
      if (focusData.sessionId) body.session_id = focusData.sessionId
      if (creditForm.customer_phone.trim()) body.customer_phone = creditForm.customer_phone.trim()
      if (creditForm.memo.trim()) body.memo = creditForm.memo.trim()

      const res = await apiFetch("/api/credits", {
        method: "POST",
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.message || "외상 등록 실패"); return }
      setCreditModalOpen(false)
      setCreditForm(INITIAL)
      await fetchRooms()
    } catch { setError("요청 오류") }
    finally { setSubmitting(false) }
  }, [creditForm, deps])

  return {
    creditModalOpen,
    creditForm,
    managerList,
    submitting,
    openCreditModal,
    closeCreditModal,
    updateCreditForm,
    submitCredit,
  }
}
