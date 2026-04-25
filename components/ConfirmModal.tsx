"use client"

/**
 * 앱 톤과 일치하는 확인 모달.
 *
 * 2026-04-25: `window.confirm()` 대체. 이전엔 브라우저 기본 다이얼로그라
 *   앱 디자인과 이질적이고 모바일에서 잘림.
 *
 * 사용:
 *   const { confirm } = useConfirm()
 *   const ok = await confirm({
 *     title: "체크아웃 하시겠습니까?",
 *     description: "...",
 *     danger: false,
 *     confirmLabel: "체크아웃",
 *   })
 *   if (!ok) return
 *
 * 주의: <ConfirmProvider> 로 감싸야 동작. layout 에 1회 마운트.
 */

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react"

export type ConfirmOptions = {
  title: string
  description?: string | ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** 빨간색 강조. 삭제/취소 같은 되돌릴 수 없는 작업. */
  danger?: boolean
}

type ConfirmContextValue = {
  confirm: (options: ConfirmOptions) => Promise<boolean>
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null)

export function useConfirm(): ConfirmContextValue {
  const v = useContext(ConfirmContext)
  if (!v) {
    // Provider 없으면 window.confirm fallback.
    return {
      confirm: (opts) => Promise.resolve(
        typeof window !== "undefined"
          ? window.confirm(
              opts.title +
              (opts.description && typeof opts.description === "string"
                ? `\n\n${opts.description}`
                : ""),
            )
          : false,
      ),
    }
  }
  return v
}

type ConfirmState = ConfirmOptions & {
  resolve: (ok: boolean) => void
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<ConfirmState | null>(null)

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>(resolve => {
      setPending({ ...options, resolve })
    })
  }, [])

  function resolveAndClose(ok: boolean) {
    if (!pending) return
    pending.resolve(ok)
    setPending(null)
  }

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {pending && (
        <div
          className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4 print:hidden"
          onClick={() => resolveAndClose(false)}
        >
          <div
            className="bg-[#0b0e1c] border border-white/10 rounded-2xl max-w-sm w-full p-5"
            onClick={e => e.stopPropagation()}
            role="alertdialog"
            aria-modal="true"
          >
            <div className={`text-base font-semibold mb-2 ${pending.danger ? "text-red-300" : "text-white"}`}>
              {pending.title}
            </div>
            {pending.description && (
              <div className="text-xs text-slate-400 leading-relaxed mb-4 whitespace-pre-wrap">
                {pending.description}
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => resolveAndClose(false)}
                className="flex-1 py-2.5 rounded-xl bg-white/[0.03] border border-white/10 text-slate-400 text-sm hover:bg-white/[0.06]"
              >
                {pending.cancelLabel ?? "취소"}
              </button>
              <button
                onClick={() => resolveAndClose(true)}
                autoFocus
                className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border ${
                  pending.danger
                    ? "bg-red-500/20 text-red-200 border-red-500/40 hover:bg-red-500/30"
                    : "bg-cyan-500/20 text-cyan-200 border-cyan-500/40 hover:bg-cyan-500/30"
                }`}
              >
                {pending.confirmLabel ?? "확인"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}
