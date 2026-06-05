import type { ReactNode } from "react"

/**
 * /m/monitor 전용 sublayout — 기존 dark theme 유지.
 *
 * 2026-06-03 R-스태프동기화-Next: 부모 /m/layout.tsx 를 스태프동기화 앱
 *   shell (밝은 톤) 로 전환하면서, monitor 의 dark theme 은 이 sublayout 에
 *   격리. monitor 화면은 기존과 동일하게 동작.
 */
export default function MonitorLayout({ children }: { children: ReactNode }) {
  return (
    <div
      className="min-h-screen bg-[#07091A] text-slate-200"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      }}
    >
      {children}
    </div>
  )
}
