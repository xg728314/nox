"use client"
import { createContext, useCallback, useContext, useState, type ReactNode } from "react"
import { cn } from "../_lib/cn"

type ToastKind = "info" | "success" | "error"
type ToastItem = { id: number; msg: string; kind: ToastKind }

type ToastCtx = { show: (msg: string, kind?: ToastKind) => void }
const Ctx = createContext<ToastCtx | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const show = useCallback((msg: string, kind: ToastKind = "info") => {
    const id = Date.now() + Math.random()
    setItems((arr) => [...arr, { id, msg, kind }])
    setTimeout(() => {
      setItems((arr) => arr.filter((t) => t.id !== id))
    }, 2400)
  }, [])
  return (
    <Ctx.Provider value={{ show }}>
      {children}
      <div className="fixed top-16 left-0 right-0 z-[200] flex flex-col items-center gap-2 pointer-events-none px-4">
        {items.map((t) => (
          <div
            key={t.id}
            className={cn(
              "rounded-full px-4 py-2 text-[12px] font-bold shadow-lg backdrop-blur-md pointer-events-auto animate-fade-in",
              t.kind === "success" && "bg-green-600 text-white",
              t.kind === "error" && "bg-red-600 text-white",
              t.kind === "info" && "bg-[#2D2B26]/90 text-white",
            )}
          >
            {t.msg}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

export function useToast() {
  const ctx = useContext(Ctx)
  return useCallback(
    (msg: string, kind?: ToastKind) => {
      if (ctx) ctx.show(msg, kind)
      else if (typeof window !== "undefined") console.log(`[toast:${kind ?? "info"}]`, msg)
    },
    [ctx],
  )
}

/** vibrate helper */
export function haptic(pattern: number | number[] = 10) {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    try {
      navigator.vibrate(pattern)
    } catch {
      /* ignore */
    }
  }
}

