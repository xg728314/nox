"use client"

import CreditModal from "./CreditModal"
import type { StaffItem } from "../types"
import type { CreditFormState } from "../hooks/useCreditFlow"

/**
 * CreditSection — trigger button + CreditModal wrapper.
 *
 * Pure composition. All state and mutation live in useCreditFlow.
 * This component is only responsible for presenting an entry point and
 * mounting the modal when it's open.
 *
 * Rendered at the CounterPageV2 level as a floating action button when a
 * room is in focus. Clicking it invokes useCreditFlow.openCreditModal().
 */

type Props = {
  // Legacy props retained for callers that still pass them. The floating
  // trigger button has been moved to CounterSidebar, so `focused` / `onOpen`
  // are no-ops here.
  focused?: boolean
  onOpen?: () => void

  // modal state + form owned by useCreditFlow
  open: boolean
  busy: boolean
  form: CreditFormState
  managers: StaffItem[]
  onClose: () => void
  onChange: (patch: Partial<CreditFormState>) => void
  onSubmit: () => void
}

export default function CreditSection({
  open, busy, form, managers,
  onClose, onChange, onSubmit,
}: Props) {
  // STEP: the floating "외상" trigger was moved into CounterSidebar's bottom
  // action section. This component is now purely the modal host; the sidebar
  // invokes onOpen directly via its own button. `focused` / `onOpen` props
  // are kept in the type for backwards-compatibility with the page wiring
  // but are intentionally unused here.
  return (
    <>
      <CreditModal
        open={open}
        busy={busy}
        form={form}
        managers={managers}
        onChange={onChange}
        onClose={onClose}
        onSubmit={onSubmit}
      />
    </>
  )
}
