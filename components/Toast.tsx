"use client"

/**
 * 전역 Toast 알림 시스템.
 *
 * 2026-04-25: window.alert() 대체. 앱 톤과 일치하고, 자동 사라지고,
 *   여러 개 스택 가능.
 *
 * 사용:
 *   const { show } = useToast()
 *   show({ type: "success", message: "저장되었습니다" })
 *
 * 주의: <ToastProvider> 로 감싸야 useToast 동작. _app 또는 layout 에 1회 마운트.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"

export type ToastType = "success" | "error" | "warning" | "info"

export type ToastInput = {
  type?: ToastType
  message: string
  /** 자동 사라질 시간 (ms). 기본 3000. 0 = 수동 닫기만. */
  duration?: number
}

type ToastItem = ToastInput & {
  id: string
  type: ToastType
  duration: number
}

type ToastContextValue = {
  show: (input: ToastInput) => void
  dismiss: (id: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const v = useContext(ToastContext)
  if (!v) {
    // Provider 없으면 console 로 fallback (개발 편의).
    return {
      show: ({ type = "info", message }) => {
        // eslint-disable-next-line no-console
        console[type === "error" ? "error" : type === "warning" ? "warn" : "log"](
          `[toast:${type}] ${message}`,
        )
      },
      dismiss: () => {},
    }
  }
  return v
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const show = useCallback((input: ToastInput) => {
    const id = `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const item: ToastItem = {
      id,
      type: input.type ?? "info",
      message: input.message,
      duration: input.duration ?? 3000,
    }
    setToasts(prev => [...prev, item])
    if (item.duration > 0) {
      setTimeout(() => dismiss(id), item.duration)
    }
  }, [dismiss])

  return (
    <ToastContext.Provider value={{ show, dismiss }}>
      {children}
      {toasts.length > 0 && (
        <div className="fixed bottom-20 right-4 z-[60] flex flex-col gap-2 pointer-events-none print:hidden">
          {toasts.map(t => (
            <div
              key={t.id}
              className={`pointer-events-auto px-4 py-3 rounded-xl text-sm shadow-lg backdrop-blur max-w-sm animate-[slideIn_0.2s_ease-out] ${
                t.type === "success"
                  ? "bg-emerald-500/95 text-white border border-emerald-400"
                  : t.type === "error"
                    ? "bg-red-500/95 text-white border border-red-400"
                    : t.type === "warning"
                      ? "bg-amber-500/95 text-white border border-amber-400"
                      : "bg-slate-700/95 text-slate-100 border border-slate-600"
              }`}
              onClick={() => dismiss(t.id)}
              role="status"
            >
              {t.message}
            </div>
          ))}
        </div>
      )}
    </ToastContext.Provider>
  )
}

/**
 * 전역 Provider 없이도 쓸 수 있는 경량 fallback. 페이지 한 구석에 토스트 띄움.
 * 기존 alert() 대체에 빠르게 쓰기용.
 */
export function toastSimple(message: string, type: ToastType = "info", duration = 3000) {
  if (typeof window === "undefined") return
  const id = `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const node = document.createElement("div")
  node.id = id
  const palette: Record<ToastType, string> = {
    success: "background:#10b981;border:1px solid #34d399;",
    error: "background:#ef4444;border:1px solid #f87171;",
    warning: "background:#f59e0b;border:1px solid #fbbf24;",
    info: "background:#334155;border:1px solid #64748b;",
  }
  node.setAttribute(
    "style",
    `${palette[type]} color:#fff; position:fixed; bottom:80px; right:16px; z-index:9999; ` +
    `padding:12px 16px; border-radius:12px; font-size:14px; max-width:360px; ` +
    `box-shadow:0 4px 12px rgba(0,0,0,0.3); cursor:pointer; ` +
    `font-family:system-ui,sans-serif; opacity:0; transform:translateY(10px); ` +
    `transition:opacity 0.2s, transform 0.2s;`,
  )
  node.textContent = message
  node.addEventListener("click", () => node.remove())
  document.body.appendChild(node)
  requestAnimationFrame(() => {
    node.style.opacity = "1"
    node.style.transform = "translateY(0)"
  })
  if (duration > 0) {
    setTimeout(() => {
      node.style.opacity = "0"
      node.style.transform = "translateY(10px)"
      setTimeout(() => node.remove(), 200)
    }, duration)
  }
}
