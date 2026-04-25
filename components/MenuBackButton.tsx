"use client"

/**
 * 메뉴 루트 페이지의 "뒤로" 버튼.
 *
 * 2026-04-26: 기존 router.back() 은 브라우저 history 가 꼬여있으면 같은
 *   페이지를 왔다갔다 한다는 사용자 피드백.
 *
 * 정책 (사용자 요청):
 *   - 메뉴 루트 (/chat, /reconcile, /me 등) → 뒤로 = /counter 로 직행
 *   - 메뉴 서브 (/chat/[id], /me/security 등) → 기본은 router.back() (한 단계 위)
 *
 * 사용:
 *   <MenuBackButton />              — 메뉴 루트용 (→ /counter)
 *   <MenuBackButton fallback="/chat" /> — 서브 페이지용 (history 비어있으면 /chat)
 *   <MenuBackButton label="목록" />  — 라벨 커스터마이즈
 */

import { useRouter } from "next/navigation"

type Props = {
  /** 클릭 시 이동할 경로. 기본 "/counter". */
  fallback?: string
  /** 버튼 텍스트. 기본 "← 뒤로". */
  label?: string
  className?: string
}

export default function MenuBackButton({
  fallback = "/counter",
  label = "← 뒤로",
  className = "text-cyan-400 text-sm",
}: Props) {
  const router = useRouter()
  return (
    <button
      type="button"
      onClick={() => router.push(fallback)}
      className={className}
    >
      {label}
    </button>
  )
}
