/**
 * Shared number/currency formatters.
 *
 * 2026-04-24: 페이지별 포맷 로직이 제각각 (toFixed(0)·/10000·toLocaleString
 *   인라인) 이어서 단일 source 로 통합. 모든 함수는 null/undefined/NaN
 *   안전하며 placeholder ("−") 를 반환.
 *
 * 사용 지침
 *   - 정밀 금액 (영수증/청구서/정산 상세)  → fmtWon
 *   - 요약/대시보드 카드 (만 단위, 가독성) → fmtMan
 *   - 건수/인원/비율 등 단위 없는 수치    → fmtNumber / fmtPercent
 */

const PLACEHOLDER = "−"

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n)
}

/** ₩1,234,567 — 정확한 금액 표기. null/NaN → "−". */
export function fmtWon(n: number | null | undefined): string {
  if (!isFiniteNumber(n)) return PLACEHOLDER
  return `₩${n.toLocaleString()}`
}

/**
 * 만 단위 요약 표기.
 *   500000  → "50만"
 *   523400  → "52만3,400"
 *   7000    → "7,000원"
 *   null    → "−"
 *
 * 대시보드/overview 카드처럼 공간 좁은 곳에서 사용.
 */
export function fmtMan(n: number | null | undefined): string {
  if (!isFiniteNumber(n)) return PLACEHOLDER
  if (n < 0) return `-${fmtMan(-n)}`
  if (n >= 10000) {
    const man = Math.floor(n / 10000)
    const remainder = n % 10000
    if (remainder === 0) return `${man}만`
    return `${man}만${remainder.toLocaleString()}`
  }
  return `${n.toLocaleString()}원`
}

/** 1,234 — 단위 없는 정수 표기. */
export function fmtNumber(n: number | null | undefined): string {
  if (!isFiniteNumber(n)) return PLACEHOLDER
  return n.toLocaleString()
}

/**
 * 퍼센트 표기. 입력은 0~100 범위의 "이미 계산된 퍼센트" 가정.
 *   fmtPercent(29)      → "29%"
 *   fmtPercent(29.4, 1) → "29.4%"
 */
export function fmtPercent(n: number | null | undefined, digits = 0): string {
  if (!isFiniteNumber(n)) return PLACEHOLDER
  return `${n.toFixed(digits)}%`
}

/**
 * 날짜/시간 통합 포맷. 2026-04-25: 페이지별로 toLocaleString 옵션이 달라서
 *   "4월 25일" vs "2026-04-25" vs "04/25" 혼재. 공용 헬퍼로 통일.
 */
function parseDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null
  const d = typeof v === "string" ? new Date(v) : v
  return Number.isFinite(d.getTime()) ? d : null
}

/** "4월 25일" — 짧은 날짜 (당해 연도 가정). */
export function fmtDateShort(v: string | Date | null | undefined): string {
  const d = parseDate(v)
  if (!d) return PLACEHOLDER
  return `${d.getMonth() + 1}월 ${d.getDate()}일`
}

/** "2026-04-25" — ISO 날짜. 영수증/감사 로그용. */
export function fmtDateISO(v: string | Date | null | undefined): string {
  const d = parseDate(v)
  if (!d) return PLACEHOLDER
  return d.toISOString().split("T")[0]
}

/** "14:30" — 24시간제 시:분. 2026-04-25: ko-KR 로케일의 AM/PM 접두 회피. */
export function fmtTimeHM(v: string | Date | null | undefined): string {
  const d = parseDate(v)
  if (!d) return PLACEHOLDER
  const h = String(d.getHours()).padStart(2, "0")
  const m = String(d.getMinutes()).padStart(2, "0")
  return `${h}:${m}`
}

/** "4월 25일 14:30" — 날짜+시간. 목록/이력용. */
export function fmtDateTime(v: string | Date | null | undefined): string {
  const d = parseDate(v)
  if (!d) return PLACEHOLDER
  return `${fmtDateShort(d)} ${fmtTimeHM(d)}`
}
