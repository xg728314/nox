import type { Participant } from "./types"

/** 종목별 반티 기준 시간 (분) */
export const BANTI_MINUTES: Record<string, number> = {
  "퍼블릭": 45,
  "셔츠": 30,
  "하퍼": 30,
}

/** 종목별 연장 시간 (분) — 완티 / 반티 / 차3 */
export type ExtendType = "완티" | "반티" | "차3"

export const EXTEND_MINUTES: Record<string, Record<ExtendType, number>> = {
  "퍼블릭": { "완티": 90, "반티": 45, "차3": 15 },
  "셔츠":   { "완티": 60, "반티": 30, "차3": 15 },
  "하퍼":   { "완티": 60, "반티": 30, "차3": 15 },
}

/** 참여자의 종목에 맞는 연장 시간(분) 반환. 종목 미설정 시 60분 fallback */
export function getExtendMinutes(category: string | null | undefined, type: ExtendType): number {
  if (!category || !EXTEND_MINUTES[category]) {
    return type === "완티" ? 60 : type === "반티" ? 30 : 15
  }
  return EXTEND_MINUTES[category][type]
}

export function fmtWon(n: number): string {
  return `₩${n.toLocaleString()}`
}

export function fmtTime(iso: string): string {
  if (!iso) return "-"
  return new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })
}

export function getElapsed(started_at: string): string {
  if (!started_at) return "-"
  const diff = Math.floor((Date.now() - new Date(started_at).getTime()) / 60000)
  const h = Math.floor(diff / 60)
  const m = diff % 60
  return h > 0 ? `${h}시간 ${m}분` : `${m}분`
}

/** 개별 참여자 남은 밀리초 — entered_at 없으면 sessionStartedAt + 60분 fallback */
export function remainingMsForParticipant(p: Participant, now: number, sessionStartedAt?: string): number {
  const startIso = p.entered_at || sessionStartedAt
  if (!startIso) return 0
  const minutes = p.time_minutes && p.time_minutes > 0 ? p.time_minutes : 60
  const end = new Date(startIso).getTime() + minutes * 60000
  return Math.max(0, end - now)
}

/** 방기준 남은 밀리초 — 가장 먼저 entered_at인 active 참여자 기준 */
export function roomRemainingMs(participants: Participant[], now: number, sessionStartedAt?: string): number {
  const active = participants.filter(p => p.status === "active" && p.entered_at)
  if (active.length === 0) {
    if (sessionStartedAt) {
      const end = new Date(sessionStartedAt).getTime() + 60 * 60000
      return Math.max(0, end - now)
    }
    return 0
  }
  const first = [...active].sort((a, b) =>
    new Date(a.entered_at).getTime() - new Date(b.entered_at).getTime()
  )[0]
  return remainingMsForParticipant(first, now, sessionStartedAt)
}

export function fmtRemaining(ms: number): string {
  if (ms <= 0) return "종료"
  const totalMin = Math.ceil(ms / 60000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h > 0 && m > 0) return `${h}시간 ${m}분`
  if (h > 0) return `${h}시간`
  return `${m}분`
}

export function remainingColor(ms: number): string {
  const min = ms / 60000
  if (min >= 30) return "text-emerald-400"
  if (min >= 10) return "text-amber-300"
  return "text-red-400"
}

/**
 * 이득시간 (ms) — participant 개별 남은시간이 방 남은시간보다 길 때의 차이.
 * 방 잔여시간이 반티 기준보다 짧으면 그 짧은 시간만 일하고 반티 단가를 받으므로,
 * 차이만큼이 이득시간이다. 이득시간은 실시간으로 변하지 않는다(두 타이머 차이는 고정).
 */
export function profitMs(
  p: Participant,
  participants: Participant[],
  now: number,
  sessionStartedAt?: string,
): number {
  if (!p.entered_at || !p.time_minutes || p.time_minutes <= 0) return 0
  const indiv = remainingMsForParticipant(p, now, sessionStartedAt)
  const room = roomRemainingMs(participants, now, sessionStartedAt)
  return Math.max(0, indiv - room)
}

/** 분 단위 포맷 (이득시간 표시용) */
export function fmtMinutes(ms: number): string {
  const m = Math.ceil(ms / 60000)
  return `${m}분`
}

// UNIT_MINUTES 는 helpers/categoryRegistry.ts 의 단일 원본에서 파생.
// 기존 import 경로 (`import { UNIT_MINUTES } from "../helpers"`) 유지.
import { unitMinutesFor } from "./helpers/categoryRegistry"
export { UNIT_MINUTES } from "./helpers/categoryRegistry"

/**
 * 방의 기준 종목(base category)을 결정한다.
 * 규칙: 가장 먼저 입장한(entered_at 기준) active participant의 category.
 * - 퍼블릭 먼저 → base = 퍼블릭 (90분)
 * - 셔츠/하퍼 먼저 → base = 셔츠 or 하퍼 (60분)
 * - 종목 미확정이면 건너뛰고 다음 참여자 확인
 */
export function resolveBaseCategory(participants: Participant[]): {
  baseCategory: string | null
  baseUnitMinutes: number
} {
  const sorted = participants
    .filter(p => p.status === "active" && p.category && p.entered_at)
    .sort((a, b) => new Date(a.entered_at).getTime() - new Date(b.entered_at).getTime())
  const first = sorted[0]
  if (!first || !first.category) return { baseCategory: null, baseUnitMinutes: 60 }
  return {
    baseCategory: first.category,
    baseUnitMinutes: unitMinutesFor(first.category),
  }
}

/**
 * participant별 unit 계산에 사용할 경과 시간(분)과 기준 시간(분)을 결정한다.
 *
 * base category는 elapsed 적용 방식만 결정한다.
 * unitMinutes는 항상 participant 자신의 종목 기준을 사용한다.
 *
 * CASE A (public-first): 모든 participant → session elapsed
 * CASE B (shirt/half-first): shirt/half → session elapsed, public → entered_at 기준
 *
 * unitMinutes: 퍼블릭=90, 셔츠=60, 하퍼=60 (절대 통일 금지)
 */
export function resolveParticipantElapsed(
  p: Participant,
  baseCategory: string | null,
  _baseUnitMinutes: number,
  sessionStartedAt: string,
  now: number,
): { elapsedMin: number; unitMinutes: number } {
  const pCategory = p.category
  const pUnitMinutes = unitMinutesFor(pCategory)
  if (!pCategory) return { elapsedMin: 0, unitMinutes: pUnitMinutes }

  const isBasePublic = baseCategory === "퍼블릭"
  const isParticipantPublic = pCategory === "퍼블릭"

  // 예외: base가 셔츠/하퍼인데 이 participant가 퍼블릭 → 개별 entered_at 기준
  if (!isBasePublic && isParticipantPublic && p.entered_at) {
    const individualElapsed = Math.max(0, Math.floor((now - new Date(p.entered_at).getTime()) / 60000))
    return { elapsedMin: individualElapsed, unitMinutes: pUnitMinutes }
  }

  // 기본: session elapsed time + participant 자신의 종목 unitMinutes
  const sessionElapsed = Math.max(0, Math.floor((now - new Date(sessionStartedAt).getTime()) / 60000))
  return { elapsedMin: sessionElapsed, unitMinutes: pUnitMinutes }
}

/**
 * unit 계산 함수 — 경과시간을 주어진 unitMinutes 기준으로 분해.
 *
 * @param elapsedMinutes - 경과 분
 * @param unitMinutes - 1개 기준 분 (base category에 따라 90 또는 60)
 */
export function calcUnits(elapsedMinutes: number, unitMinutes: number): {
  units: number
  whole: number
  half: boolean
  remainderMin: number
  unitMinutes: number
} {
  if (elapsedMinutes <= 0 || unitMinutes <= 0) return { units: 0, whole: 0, half: false, remainderMin: 0, unitMinutes }
  const whole = Math.floor(elapsedMinutes / unitMinutes)
  const remainder = elapsedMinutes - whole * unitMinutes
  const halfUnit = unitMinutes / 2
  const half = remainder === halfUnit
  const units = whole + (half ? 0.5 : remainder / unitMinutes)
  return { units, whole, half, remainderMin: half ? 0 : remainder, unitMinutes }
}

/**
 * 경과시간을 기준 unit 개수 문자열로 변환.
 *
 * @param elapsedMinutes - 경과 분
 * @param unitMinutes - 1개 기준 분
 */
export function fmtUnitCount(elapsedMinutes: number, unitMinutes: number): string | null {
  // UI rule: do NOT show minutes. Always render in 개(반티) units.
  // Internal calc (calcUnits) is unchanged — only the display string switches.
  if (elapsedMinutes <= 0 || unitMinutes <= 0) return null
  const { whole, half, remainderMin } = calcUnits(elapsedMinutes, unitMinutes)
  if (whole === 0 && half) return "반티"
  if (whole === 0 && !half) {
    // partial under one unit with no half mark → count as 1개
    return remainderMin > 0 ? "1개" : null
  }
  if (half) return `${whole}.5개`
  if (remainderMin === 0) return `${whole}개`
  // partial beyond N whole units → round up to the next whole count
  return `${whole + 1}개`
}
