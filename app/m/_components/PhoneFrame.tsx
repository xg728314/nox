"use client"
import { type ReactNode } from "react"

/**
 * 데스크탑 시뮬레이션용 폰 프레임.
 * 모바일 폭(<=540px)에서는 프레임 없이 풀스크린.
 */
export function PhoneFrame({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-[100dvh] bg-black flex items-center justify-center md:py-4">
      <div className="w-full h-[100dvh] md:h-auto md:w-[420px] md:max-h-[900px] md:rounded-[44px] md:overflow-hidden md:border-[10px] md:border-black md:shadow-[0_30px_60px_rgba(0,0,0,0.4)] relative bg-[#F8F4ED]">
        <div className="w-full h-full relative overflow-y-auto overflow-x-hidden">
          {/* iOS notch (데스크탑에서만) */}
          <div className="hidden md:block absolute top-2 left-1/2 -translate-x-1/2 w-[110px] h-[28px] bg-black rounded-full z-50 pointer-events-none" />
          {children}
        </div>
      </div>
    </div>
  )
}
