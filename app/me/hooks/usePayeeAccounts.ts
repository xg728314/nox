"use client"

import { useCallback, useEffect, useState } from "react"
import { apiFetch } from "@/lib/apiFetch"

/**
 * usePayeeAccounts — store-scoped payee directory (external/manager
 * destinations for future settlement payouts).
 *
 * linked_membership_id is optional — a payee can be an external party that
 * has no membership in this store. The list is visible to any authenticated
 * store member, and mutations all flow through the /api/me/payees routes
 * which enforce store_uuid scoping.
 */

export type PayeeAccount = {
  id: string
  linked_membership_id: string | null
  payee_name: string | null
  role_type: string | null
  bank_name: string | null
  account_holder_name: string | null
  account_number: string | null
  is_active: boolean
  note: string | null
  created_at: string
  updated_at: string
}

export type PayeeForm = {
  id: string | null
  payee_name: string
  role_type: string
  linked_membership_id: string
  bank_name: string
  account_holder_name: string
  account_number: string
  is_active: boolean
  note: string
}

const EMPTY_FORM: PayeeForm = {
  id: null,
  payee_name: "",
  role_type: "",
  linked_membership_id: "",
  bank_name: "",
  account_holder_name: "",
  account_number: "",
  is_active: true,
  note: "",
}

type UsePayeeAccountsReturn = {
  payees: PayeeAccount[]
  loading: boolean
  error: string
  modalOpen: boolean
  form: PayeeForm
  submitting: boolean
  refresh: () => Promise<void>
  openModal: (payee?: PayeeAccount) => void
  closeModal: () => void
  updateForm: (patch: Partial<PayeeForm>) => void
  submitForm: () => Promise<void>
  removePayee: (id: string) => Promise<void>
}

export function usePayeeAccounts(seed?: PayeeAccount[] | null): UsePayeeAccountsReturn {
  const seeded = Array.isArray(seed)
  const [payees, setPayees] = useState<PayeeAccount[]>(seeded ? (seed as PayeeAccount[]) : [])
  const [loading, setLoading] = useState(!seeded)
  const [error, setError] = useState("")
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<PayeeForm>(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [seededInitial] = useState<boolean>(seeded)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const res = await apiFetch("/api/me/payees")
      if (res.ok) {
        const d = await res.json()
        setPayees((d.payees ?? []) as PayeeAccount[])
      } else {
        setError("지급 대상 목록을 불러올 수 없습니다.")
      }
    } catch {
      setError("서버 오류")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (seededInitial) return
    refresh()
  }, [refresh, seededInitial])

  const openModal = useCallback((payee?: PayeeAccount) => {
    setError("")
    if (payee) {
      setForm({
        id: payee.id,
        payee_name: payee.payee_name ?? "",
        role_type: payee.role_type ?? "",
        linked_membership_id: payee.linked_membership_id ?? "",
        bank_name: payee.bank_name ?? "",
        account_holder_name: payee.account_holder_name ?? "",
        account_number: payee.account_number ?? "",
        is_active: payee.is_active,
        note: payee.note ?? "",
      })
    } else {
      setForm(EMPTY_FORM)
    }
    setModalOpen(true)
  }, [])

  const closeModal = useCallback(() => { setModalOpen(false) }, [])

  const updateForm = useCallback((patch: Partial<PayeeForm>) => {
    setForm(prev => ({ ...prev, ...patch }))
  }, [])

  const submitForm = useCallback(async () => {
    if (!form.payee_name.trim()) { setError("지급 대상명을 입력하세요."); return }
    if (!form.bank_name.trim()) { setError("은행명을 입력하세요."); return }
    if (!form.account_holder_name.trim()) { setError("예금주를 입력하세요."); return }
    if (!form.account_number.trim()) { setError("계좌번호를 입력하세요."); return }
    setSubmitting(true)
    setError("")
    try {
      const payload = {
        payee_name: form.payee_name.trim(),
        role_type: form.role_type.trim() || null,
        linked_membership_id: form.linked_membership_id.trim() || null,
        bank_name: form.bank_name.trim(),
        account_holder_name: form.account_holder_name.trim(),
        account_number: form.account_number.trim(),
        is_active: form.is_active,
        note: form.note.trim() || null,
      }
      const res = form.id
        ? await apiFetch(`/api/me/payees/${form.id}`, { method: "PATCH", body: JSON.stringify(payload) })
        : await apiFetch("/api/me/payees", { method: "POST", body: JSON.stringify(payload) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setError(d.message || "저장 실패"); return }
      setModalOpen(false)
      setForm(EMPTY_FORM)
      await refresh()
    } catch {
      setError("서버 오류")
    } finally {
      setSubmitting(false)
    }
  }, [form, refresh])

  const removePayee = useCallback(async (id: string) => {
    setError("")
    try {
      const res = await apiFetch(`/api/me/payees/${id}`, { method: "DELETE" })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.message || "삭제 실패")
        return
      }
      await refresh()
    } catch {
      setError("서버 오류")
    }
  }, [refresh])

  return {
    payees, loading, error,
    modalOpen, form, submitting,
    refresh, openModal, closeModal, updateForm, submitForm, removePayee,
  }
}
