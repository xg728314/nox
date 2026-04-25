"use client"

import AccountSelectModal from "./modals/AccountSelectModal"
import type { BankAccount } from "../types"
import type { AccountMode } from "../hooks/useAccountSelectionFlow"

type Props = {
  visible?: boolean
  selectedAccount?: BankAccount | null
  onOpen?: () => void

  modalOpen: boolean
  loading: boolean
  accounts: BankAccount[]
  sharedAccounts: BankAccount[]
  pickedId: string | null
  mode: AccountMode
  manualInput: { bank_name: string; account_number: string; holder_name: string }
  onClose: () => void
  onPick: (id: string) => void
  onSetMode: (mode: AccountMode) => void
  onSetManualInput: (input: { bank_name: string; account_number: string; holder_name: string }) => void
  onConfirm: () => void
}

export default function AccountSelectTrigger({
  modalOpen, loading, accounts, sharedAccounts, pickedId, mode, manualInput,
  onClose, onPick, onSetMode, onSetManualInput, onConfirm,
}: Props) {
  return (
    <>
      <AccountSelectModal
        open={modalOpen}
        loading={loading}
        accounts={accounts}
        sharedAccounts={sharedAccounts}
        pickedId={pickedId}
        mode={mode}
        manualInput={manualInput}
        onPick={onPick}
        onSetMode={onSetMode}
        onSetManualInput={onSetManualInput}
        onClose={onClose}
        onConfirm={onConfirm}
      />
    </>
  )
}
