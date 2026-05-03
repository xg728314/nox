import type { ReactNode } from "react"
import CafeShell from "@/components/cafe/CafeShell"
import { CafeManageProvider } from "@/components/cafe/CafeManageContext"

/**
 * /cafe/manage/* 공통 레이아웃.
 * Provider 가 한 번만 bootstrap fetch → 모든 페이지/사이드바 공유.
 */
export default function CafeManageLayout({ children }: { children: ReactNode }) {
  return (
    <CafeManageProvider>
      <CafeShell>{children}</CafeShell>
    </CafeManageProvider>
  )
}
