"use client"

import { useCallback, useState, type Dispatch, type SetStateAction } from "react"
import { apiFetch } from "@/lib/apiFetch"
import type { BankAccount } from "../types"

export type AccountMode = "manager" | "shared" | "manual" | "hidden"

type ManualInput = { bank_name: string; account_number: string; holder_name: string }

type Deps = {
  setError: Dispatch<SetStateAction<string>>
  onConfirm?: (account: BankAccount | null) => void
}

type UseAccountSelectionFlowReturn = {
  modalOpen: boolean
  accounts: BankAccount[]
  sharedAccounts: BankAccount[]
  loading: boolean
  pickedId: string | null
  selectedAccount: BankAccount | null
  mode: AccountMode
  manualInput: ManualInput
  openModal: () => Promise<void>
  closeModal: () => void
  pickAccount: (id: string) => void
  setMode: (mode: AccountMode) => void
  setManualInput: (input: ManualInput) => void
  confirmSelection: () => void
  clearSelection: () => void
}

export function useAccountSelectionFlow(deps: Deps): UseAccountSelectionFlowReturn {
  const [modalOpen, setModalOpen] = useState(false)
  const [accounts, setAccounts] = useState<BankAccount[]>([])
  const [sharedAccounts, setSharedAccounts] = useState<BankAccount[]>([])
  const [loading, setLoading] = useState(false)
  const [pickedId, setPickedId] = useState<string | null>(null)
  const [selectedAccount, setSelectedAccount] = useState<BankAccount | null>(null)
  const [mode, setMode] = useState<AccountMode>("manager")
  const [manualInput, setManualInput] = useState<ManualInput>({ bank_name: "", account_number: "", holder_name: "" })

  const openModal = useCallback(async () => {
    deps.setError("")
    setModalOpen(true)
    setPickedId(prev => prev ?? selectedAccount?.id ?? null)
    setLoading(true)
    try {
      // Fetch personal accounts
      const res = await apiFetch("/api/me/accounts")
      if (res.ok) {
        const d = await res.json()
        type RawAccount = {
          id: string
          bank_name: string | null
          account_number: string | null
          account_holder_name?: string | null
          holder_name?: string | null
          is_default: boolean
          is_active: boolean
          is_shared?: boolean
        }
        const raw = (d.accounts ?? []) as RawAccount[]
        const list: BankAccount[] = raw.map(a => ({
          id: a.id,
          bank_name: a.bank_name ?? "",
          account_number: a.account_number ?? "",
          holder_name: a.account_holder_name ?? a.holder_name ?? "",
          is_default: a.is_default,
          is_active: a.is_active,
          is_shared: a.is_shared ?? false,
        }))
        // Personal: active + NOT shared
        const personal = list.filter(a => a.is_active && !a.is_shared)
        // Shared: active + is_shared (same store only — API already scopes by store)
        const shared = list.filter(a => a.is_active && a.is_shared)
        setAccounts(personal)
        setSharedAccounts(shared)
        setPickedId(prev => {
          if (prev) return prev
          const def = personal.find(a => a.is_default)
          return def?.id ?? (personal[0]?.id ?? null)
        })
      } else {
        deps.setError("계좌 목록을 불러올 수 없습니다.")
      }
    } catch {
      deps.setError("서버 오류")
    } finally {
      setLoading(false)
    }
  }, [deps, selectedAccount])

  const closeModal = useCallback(() => {
    setModalOpen(false)
  }, [])

  const pickAccount = useCallback((id: string) => {
    setPickedId(id)
  }, [])

  const confirmSelection = useCallback(() => {
    if (mode === "hidden") {
      setSelectedAccount(null)
      setModalOpen(false)
      deps.onConfirm?.(null)
      return
    }

    if (mode === "manual") {
      if (!manualInput.bank_name.trim() || !manualInput.account_number.trim()) return
      const manual: BankAccount = {
        id: "manual",
        bank_name: manualInput.bank_name.trim(),
        account_number: manualInput.account_number.trim(),
        holder_name: manualInput.holder_name.trim(),
        is_default: false,
        is_active: true,
      }
      setSelectedAccount(manual)
      setModalOpen(false)
      deps.onConfirm?.(manual)
      return
    }

    if (!pickedId) return
    const list = mode === "shared" ? sharedAccounts : accounts
    const acc = list.find(a => a.id === pickedId)
    if (!acc) return
    setSelectedAccount(acc)
    setModalOpen(false)
    deps.onConfirm?.(acc)
  }, [mode, pickedId, accounts, sharedAccounts, manualInput, deps])

  const clearSelection = useCallback(() => {
    setSelectedAccount(null)
    setPickedId(null)
  }, [])

  return {
    modalOpen,
    accounts,
    sharedAccounts,
    loading,
    pickedId,
    selectedAccount,
    mode,
    manualInput,
    openModal,
    closeModal,
    pickAccount,
    setMode,
    setManualInput,
    confirmSelection,
    clearSelection,
  }
}
