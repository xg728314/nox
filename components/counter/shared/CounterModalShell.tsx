"use client"
export function CounterModalShell({ open, onClose, children, overlayClassName, panelClassName }: { open: boolean; onClose: () => void; children: React.ReactNode; overlayClassName?: string; panelClassName?: string }) {
  if (!open) return null
  return (
    <div className={overlayClassName || "fixed inset-0 z-50 bg-black/50 flex items-center justify-center"} onClick={onClose}>
      <div className={panelClassName || "bg-[#0a1628] rounded-2xl p-6 max-w-md w-full mx-4"} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}
