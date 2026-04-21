/**
 * categoryRegistry — category / unit-minutes / ticket 규칙의 단일 원본.
 *
 * P1 구조 고정 (2026-04-18)
 *
 * 이 파일이 등장하기 전에는 다음 3곳에서 동일한 데이터가 중복 선언됐다:
 *   - app/counter/types.ts            `CATEGORIES = [{name, minutes}]`
 *   - app/counter/helpers.ts          `UNIT_MINUTES = { 퍼블릭:90, … }`
 *   - app/counter/components/ParticipantInlineEditor.tsx  (동일 내용)
 *
 * 그리고 ticket 규칙은:
 *   - app/counter/hooks/useParticipantMutations.ts  `ticketToPreset(...)`
 *
 * 이제 이 모듈 하나에서 파생되도록 재정의한다. 4 곳의 기존 export 는
 * 이 registry 에서 얇게 re-export 또는 호출하는 방식으로 유지되어
 * import 경로 하위 호환성은 유지된다.
 *
 * 절대 변경 금지
 *   - 기존 카테고리 이름(퍼블릭/셔츠/하퍼)
 *   - 기존 완티/반티/차3/반차3 → time_type / time_minutes 매핑
 *   - 기존 "nominal minutes" 값들 (퍼블릭 90 / 45, 셔츠·하퍼 60 / 30, 차3 15)
 *   - 서버가 최종 pricing 을 계산한다는 계약 (CLAUDE.md lock)
 */

// ── 카테고리 ─────────────────────────────────────────────────────

export type CategoryLabel = "퍼블릭" | "셔츠" | "하퍼"

export const CATEGORY_LABELS: readonly CategoryLabel[] = ["퍼블릭", "셔츠", "하퍼"] as const

/**
 * 카테고리별 1개(완티) 기준 시간(분).
 * 퍼블릭 90 / 셔츠·하퍼 60 — CLAUDE.md 비즈니스 규칙 locked.
 */
export const UNIT_MINUTES: Readonly<Record<CategoryLabel, number>> = {
  "퍼블릭": 90,
  "셔츠":   60,
  "하퍼":   60,
} as const

/**
 * picker UI 가 기대하는 `{ name, minutes }` 포맷.
 * 기존 `app/counter/types.ts` 에서 이 이름으로 CATEGORIES 를 export 해왔고,
 * ParticipantSetupSheetV2 등에서 같은 형태로 렌더한다. 값 보존.
 */
export const CATEGORIES: ReadonlyArray<{ name: CategoryLabel; minutes: number }> =
  CATEGORY_LABELS.map(name => ({ name, minutes: UNIT_MINUTES[name] }))

/**
 * 임의 string → 유효한 CategoryLabel로 좁히는 헬퍼. 서버 응답 / 파서
 * 출력이 모두 string 이어서 type narrowing 자리에 사용.
 */
export function isCategoryLabel(v: unknown): v is CategoryLabel {
  return typeof v === "string" && (CATEGORY_LABELS as readonly string[]).includes(v)
}

/** 주어진 category에 대한 unit 분. 알 수 없으면 60 폴백. */
export function unitMinutesFor(category: string | null | undefined): number {
  if (!category) return 60
  return isCategoryLabel(category) ? UNIT_MINUTES[category] : 60
}

// ── 티켓 규칙 ────────────────────────────────────────────────────

export type TicketLabel = "완티" | "반티" | "차3" | "반차3"

export type TicketPreset = {
  time_type: "기본" | "반티" | "차3"
  time_minutes: number
  /** 반차3 boundary 케이스 — 초기 POST 이후 cha3 action PATCH 필요. */
  follow_up?: "cha3"
}

/**
 * (ticket, category) → `{ time_type, time_minutes, follow_up? }`.
 *
 * 서버 pricing 이 authoritative — 여기 minutes 는 POST schema 를
 * 만족시키기 위한 nominal value. 가격 계산 아님.
 *
 * 반차3: 초기 time_minutes 는 반티와 동일, POST 후 별도 action: "cha3" 으로
 *        cha3 금액 add-on. `follow_up = "cha3"` 가 그 신호.
 */
export function ticketToPreset(
  ticket: string | null | undefined,
  category: string | null | undefined,
): TicketPreset | null {
  if (!ticket || !category) return null
  const isPub = category === "퍼블릭"
  switch (ticket) {
    case "완티":  return { time_type: "기본", time_minutes: isPub ? 90 : 60 }
    case "반티":  return { time_type: "반티", time_minutes: isPub ? 45 : 30 }
    case "차3":   return { time_type: "차3",  time_minutes: 15 }
    case "반차3": return { time_type: "반티", time_minutes: isPub ? 45 : 30, follow_up: "cha3" }
    default:      return null
  }
}
