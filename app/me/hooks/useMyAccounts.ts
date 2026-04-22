"use client"

import { useCallback, useEffect, useState } from "react"
import { apiFetch } from "@/lib/apiFetch"

/**
 * useMyAccounts — self-scope settlement account management.
 *
 * STEP-010: points at the new /api/me/accounts endpoints (settlement_accounts
 * table). Earlier rounds pointed this hook at /api/me/bank-accounts; the new
 * endpoint owns the dedicated 내 정보 UI. The hook exposes full CRUD plus a
 * modal workflow and keeps the previous return shape (accounts, modalOpen,
 * form, submitForm) so the existing /me page mounts it without change.
 *
 * is_default is mutually exclusive per caller — the server enforces this via
 * partial unique index. Toggling a new default clears the prior default in
 * the same API call.
 */

export type MyAccount = {
  id: string
  bank_name: string | null
  account_holder_name: string | null
  account_number: string | null
  account_type: string | null
  is_default: boolean
  is_active: boolean
  note: string | null
  created_at: string
  updated_at: string
  // Legacy alias kept for components that still read `holder_name`.
  holder_name?: string | null
}

export type MyAccountForm = {
  id: string | null
  bank_name: string
  account_holder_name: string
  account_number: string
  account_type: string
  is_default: boolean
  is_active: boolean
  note: string
}

const EMPTY_FORM: MyAccountForm = {
  id: null,
  bank_name: "",
  account_holder_name: "",
  account_number: "",
  account_type: "",
  is_default: false,
  is_active: true,
  note: "",
}

type UseMyAccountsReturn = {
  accounts: MyAccount[]
  loading: boolean
  error: string
  modalOpen: boolean
  form: MyAccountForm
  submitting: boolean
  refresh: () => Promise<void>
  openModal: (account?: MyAccount) => void
  closeModal: () => void
  updateForm: (patch: Partial<MyAccountForm>) => void
  submitForm: () => Promise<void>
  removeAccount: (id: string) => Promise<void>
  setDefault: (id: string) => Promise<void>
}

export function useMyAccounts(seed?: MyAccount[] | null): UseMyAccountsReturn {
  const seeded = Array.isArray(seed)
  const [accounts, setAccounts] = useState<MyAccount[]>(
    seeded ? (seed as MyAccount[]).map((a) => ({ ...a, holder_name: a.account_holder_name })) : []
  )
  const [loading, setLoading] = useState(!seeded)
  const [error, setError] = useState("")
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<MyAccountForm>(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [seededInitial] = useState<boolean>(seeded)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const res = await apiFetch("/api/me/accounts")
      if (res.ok) {
        const d = await res.json()
        const list = ((d.accounts ?? []) as MyAccount[]).map(a => ({
          ...a,
          holder_name: a.account_holder_name,
        }))
        setAccounts(list)
      } else {
        setError("계좌 목록을 불러올 수 없습니다.")
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

  const openModal = useCallback((account?: MyAccount) => {
    setError("")
    if (account) {
      setForm({
        id: account.id,
        bank_name: account.bank_name ?? "",
        account_holder_name: account.account_holder_name ?? "",
        account_number: account.account_number ?? "",
        account_type: account.account_type ?? "",
        is_default: account.is_default,
        is_active: account.is_active,
        note: account.note ?? "",
      })
    } else {
      setForm(EMPTY_FORM)
    }
    setModalOpen(true)
  }, [])

  const closeModal = useCallback(() => { setModalOpen(false) }, [])

  const updateForm = useCallback((patch: Partial<MyAccountForm>) => {
    setForm(prev => ({ ...prev, ...patch }))
  }, [])

  const submitForm = useCallback(async () => {
    if (!form.bank_name.trim()) { setError("은행명을 입력하세요."); return }
    if (!form.account_holder_name.trim()) { setError("예금주를 입력하세요."); return }
    if (!form.account_number.trim()) { setError("계좌번호를 입력하세요."); return }
    setSubmitting(true)
    setError("")
    try {
      const payload = {
        bank_name: form.bank_name.trim(),
        account_holder_name: form.account_holder_name.trim(),
        account_number: form.account_number.trim(),
        account_type: form.account_type.trim() || null,
        is_default: form.is_default,
        is_active: form.is_active,
        note: form.note.trim() || null,
      }
      const res = form.id
        ? await apiFetch(`/api/me/accounts/${form.id}`, { method: "PATCH", body: JSON.stringify(payload) })
        : await apiFetch("/api/me/accounts", { method: "POST", body: JSON.stringify(payload) })
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

  const removeAccount = useCallback(async (id: string) => {
    setError("")
    try {
      const res = await apiFetch(`/api/me/accounts/${id}`, { method: "DELETE" })
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

  const setDefault = useCallback(async (id: string) => {
    setError("")
    try {
      const res = await apiFetch(`/api/me/accounts/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_default: true }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.message || "기본 계좌 설정 실패")
        return
      }
      await refresh()
    } catch {
      setError("서버 오류")
    }
  }, [refresh])

  return {
    accounts, loading, error,
    modalOpen, form, submitting,
    refresh, openModal, closeModal, updateForm, submitForm,
    removeAccount, setDefault,
  }
}
