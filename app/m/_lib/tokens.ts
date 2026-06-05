/**
 * 스태프동기화 모바일 — 디자인 토큰
 *
 * 기존 정적 mock (style.css) 의 색상/spacing 변수를 그대로 가져와
 * TS 상수 + Tailwind config 로 통일.
 *
 * 사용:
 *   import { TOKENS } from "@/app/m/_lib/tokens"
 *   style={{ background: TOKENS.color.card }}
 *
 * 또는 Tailwind 의 임의값:
 *   className="bg-[color:var(--m-card)]"
 */

export const TOKENS = {
  color: {
    bg: "#F8F4ED",
    bgSoft: "#EFEBE3",
    card: "#FFFCF6",
    ink: "#2D2B26",
    sub: "#7A746A",
    line: "#D8D2C8",
    gold: "#C49B61",
    goldDeep: "#A87D45",
    goldSoft: "#E4C99A",
    green: "#22C55E",
    amber: "#F59E0B",
    red: "#DC2626",
    // 종목 타입 색
    P: "#7C6F5A",
    S: "#3B82F6",
    H: "#EF4444",
  },
  radius: {
    sm: 8,
    md: 12,
    lg: 16,
    xl: 22,
    round: 999,
  },
  shadow: {
    sm: "0 1px 4px rgba(45, 43, 38, 0.04)",
    md: "0 4px 18px rgba(45, 43, 38, 0.08)",
    lg: "0 8px 32px rgba(45, 43, 38, 0.12)",
  },
} as const

export type ServiceCategory = "P" | "S" | "H"
export type StaffStatus = "working" | "waiting" | "rest" | "off"

export const CATEGORY_LABEL: Record<ServiceCategory, string> = {
  P: "P 타입",
  S: "S 타입",
  H: "H 타입",
}

export const STATUS_LABEL: Record<StaffStatus, string> = {
  working: "일하는 중",
  waiting: "대기",
  rest: "휴식",
  off: "결근",
}

export const STATUS_COLOR: Record<StaffStatus, string> = {
  working: TOKENS.color.green,
  waiting: TOKENS.color.gold,
  rest: TOKENS.color.amber,
  off: TOKENS.color.sub,
}
