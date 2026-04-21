"use client"

import { useCallback, useState, type Dispatch, type SetStateAction } from "react"
import { apiFetch } from "@/lib/apiFetch"

/**
 * useCreditSettlementFlow — credit ↔ account 연결 흐름.
 *
 * Design decision (STEP-007 → STEP-007.5):
 *   Credit submission (useCreditFlow) and account selection
 *   (useAccountSelectionFlow) are kept as independent flows per
 *   COUNTER_OWNERSHIP_RULES. This hook owns the *link* between them.
 *
 *   Structured linkage (STEP-007.5):
 *     STEP-007 used a memo-tag workaround (`[수금계좌] …` appended to
 *     credit.memo) because no FK column existed. STEP-007.5 adds a proper
 *     `credits.linked_account_id` column (migration 025) and this hook now
 *     sends it as a structured PATCH field. memo tagging is removed.
 *
 *   This hook is NOT:
 *     - an extension of useCreditFlow (that hook owns create, not state change)
 *     - an extension of useAccountSelectionFlow (that hook owns the membership
 *       bank account picker; it has no credit knowledge)
 *     - a payment processor. Real 송금 / PG / 은행 이체 / 정산 최종 확정은
 *       범위 밖.
 *
 * Data sources:
 *   - GET   /api/credits?status=pending
 *   - PATCH /api/credits/[credit_id]  (body: { status, linked_account_id? })
 */

export type CreditRow = {
  id: string
  room_name: string | null
  customer_name: string
  amount: number
  status: string
  created_at: string
  memo?: string | null
  linked_account_id?: string | null
}

type Deps = {
  setError: Dispatch<SetStateAction<string>>
}

type UseCreditSettlementFlowReturn = {
  modalOpen: boolean
  credits: CreditRow[]
  loading: boolean
  error: string
  selectedCreditId: string | null
  submitting: boolean
  openModal: () => Promise<void>
  closeModal: () => void
  selectCredit: (id: string) => void
  refresh: () => Promise<void>
  confirmLink: (
    action: "collect" | "cancel",
    linkedAccountId?: string | null,
  ) => Promise<void>
}

export function useCreditSettlementFlow(deps: Deps): UseCreditSettlementFlowReturn {
  const [modalOpen, setModalOpen] = useState(false)
  const [credits, setCredits] = useState<CreditRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setLocalError] = useState("")
  const [selectedCreditId, setSelectedCreditId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    setLocalError("")
    try {
      const res = await apiFetch("/api/credits?status=pending")
      if (res.ok) {
        const d = await res.json()
        const list = (d.credits ?? []) as CreditRow[]
        setCredits(list)
        // If the currently selected credit is no longer pending, drop it.
        setSelectedCreditId(prev => (prev && list.some(c => c.id === prev) ? prev : null))
      } else {
        setLocalError("외상 목록을 불러올 수 없습니다.")
      }
    } catch {
      setLocalError("서버 오류")
    } finally {
      setLoading(false)
    }
  }, [])

  const openModal = useCallback(async () => {
    deps.setError("")
    setLocalError("")
    setModalOpen(true)
    await refresh()
  }, [deps, refresh])

  const closeModal = useCallback(() => {
    setModalOpen(false)
  }, [])

  const selectCredit = useCallback((id: string) => {
    setSelectedCreditId(id)
    setLocalError("")
  }, [])

  const confirmLink = useCallback(
    async (action: "collect" | "cancel", linkedAccountId?: string | null) => {
      if (!selectedCreditId) { setLocalError("외상 건을 선택하세요"); return }
      const newStatus = action === "collect" ? "collected" : "cancelled"
      // Structured linkage: send linked_account_id as a first-class field on
      // collect. Cancel action does not carry an account link.
      const payload: Record<string, unknown> = { status: newStatus }
      if (action === "collect" && linkedAccountId) {
        payload.linked_account_id = linkedAccountId
      }

      setSubmitting(true)
      setLocalError("")
      try {
        const res = await apiFetch(`/api/credits/${selectedCreditId}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        })
        const data = await res.json()
        if (!res.ok) { setLocalError(data.message || "상태 변경 실패"); return }
        // Success: drop the row from the in-memory list and clear selection.
        setCredits(prev => prev.filter(c => c.id !== selectedCreditId))
        setSelectedCreditId(null)
      } catch {
        setLocalError("서버 오류")
      } finally {
        setSubmitting(false)
      }
    },
    [selectedCreditId],
  )

  return {
    modalOpen,
    credits,
    loading,
    error,
    selectedCreditId,
    submitting,
    openModal,
    closeModal,
    selectCredit,
    refresh,
    confirmLink,
  }
}
