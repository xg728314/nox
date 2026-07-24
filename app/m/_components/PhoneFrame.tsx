"use client"
import { type ReactNode } from "react"

/**
 * 데스크탑 시뮬레이션용 폰 프레임.
 *
 * 동작:
 *   - 모바일 (<=540px): 프레임 없이 풀스크린 (h-[100dvh]).
 *   - 데스크탑 (md+): 폰 프레임 고정 크기 420×min(900,vh-2rem). 콘텐츠 길이와
 *     무관하게 항상 동일한 비율. 내부 스크롤.
 *
 * 2026-06-12 R-frame-fixed: 기존 h-auto + max-h-[900px] 가 콘텐츠가 짧으면
 *   프레임도 짧아져서 페이지 이동 시 크기 들쭉날쭉. 사용자 불편.
 *   → 고정 높이 md:h-[min(900px,calc(100dvh-2rem))] 로 통일.
 */
export function PhoneFrame({ children }: { children: ReactNode }) {
  return (
    <div className="h-[100dvh] bg-black flex items-center justify-center overflow-hidden">
      {/* R-tabbar-fixed-in-frame (2026-07-24): md 프레임에 translateZ(0) → 자식
          fixed 요소의 containing block 을 프레임으로 설정. TabBar 가 phone frame
          하단에 anchored. */}
      <div
        className="w-full h-full md:w-[420px] md:h-[min(900px,calc(100dvh-2rem))] md:rounded-[44px] md:overflow-hidden md:border-[10px] md:border-black md:shadow-[0_30px_60px_rgba(0,0,0,0.4)] relative bg-[#F8F4ED]"
        style={{ transform: "translateZ(0)" }}
      >
        <div
          className="w-full h-full relative overflow-y-auto overflow-x-hidden"
          style={{ paddingBottom: "calc(72px + env(safe-area-inset-bottom))" }}
        >
          {/* iOS notch (데스크탑에서만) */}
          <div className="hidden md:block absolute top-2 left-1/2 -translate-x-1/2 w-[110px] h-[28px] bg-black rounded-full z-50 pointer-events-none" />
          {children}
        </div>
      </div>
    </div>
  )
}
