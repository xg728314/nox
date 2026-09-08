/**
 * lib/chat/bot/strictness.ts
 *
 * R36: 매장 owner 가 설정한 봇 엄격도 · 파서 결과 → 봇 답장 여부 결정.
 *
 * 4단계:
 *   friendly  : 못 알아들으면 매번 안내 (도입 초기 default)
 *   standard  : 명확한 오류만 · 애매한 건 조용히 학습
 *   strict    : 규칙 어긴 것만 짧게 지적 · 자동 등록 최소
 *   silent    : 봇 완전 침묵 · 로그만
 */

export type BotStrictness = "friendly" | "standard" | "strict" | "silent"

export const STRICTNESS_LABELS: Record<BotStrictness, { label: string; desc: string }> = {
  friendly: { label: "친절 (Friendly)", desc: "못 알아들으면 매번 안내 · 도입 초기 권장" },
  standard: { label: "표준 (Standard)", desc: "명확한 오류만 안내 · 애매한 건 조용히 학습" },
  strict:   { label: "엄격 (Strict)",   desc: "규칙 위반만 짧게 지적 · 자동 등록 최소" },
  silent:   { label: "침묵 (Silent)",   desc: "봇 완전 침묵 · 로그만 남김" },
}

/** 신뢰도 임계값 (0~1) — 이보다 낮으면 auto register 안 함 · 봇이 개입 */
export function autoRegisterThreshold(s: BotStrictness): number {
  switch (s) {
    case "friendly": return 0.6
    case "standard": return 0.75
    case "strict":   return 0.9
    case "silent":   return 0.6 // 자동 등록은 friendly 수준 · 답장만 안 함
  }
}

/** 봇 답장 허용 여부 */
export function botCanReply(s: BotStrictness): boolean {
  return s !== "silent"
}

/** 애매한 결과에도 답장할지 (standard 는 명확한 것만) */
export function replyOnAmbiguous(s: BotStrictness): boolean {
  return s === "friendly"
}
