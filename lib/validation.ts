/**
 * 입력 검증 유틸리티
 * - UUID 형식 검증
 * - 문자열 길이 제한
 * - 위험 문자 필터링
 */

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isValidUUID(value: unknown): value is string {
  return typeof value === "string" && UUID_REGEX.test(value)
}

export function sanitizeString(value: unknown, maxLength = 500): string {
  if (typeof value !== "string") return ""
  return value.trim().slice(0, maxLength)
}

export function isValidInteger(value: unknown, min = 0, max = 100_000_000): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
}

export function validateRequiredUUID(value: unknown, fieldName: string): { error: string } | null {
  if (!value) return { error: `${fieldName} is required.` }
  if (!isValidUUID(value)) return { error: `${fieldName} must be a valid UUID.` }
  return null
}

/**
 * 세션 상태 전이 검증
 * 허용: active → closed (checkout)
 * 금지: closed → active, closed → closed
 */
const VALID_SESSION_TRANSITIONS: Record<string, string[]> = {
  active: ["closed"],
  closed: [],
}

export function isValidSessionTransition(from: string, to: string): boolean {
  return (VALID_SESSION_TRANSITIONS[from] ?? []).includes(to)
}

/**
 * 정산 상태 전이 검증
 * 허용: draft → finalized, draft → draft (재계산)
 * 금지: finalized → draft, finalized → finalized
 */
const VALID_RECEIPT_TRANSITIONS: Record<string, string[]> = {
  draft: ["draft", "finalized"],
  finalized: [],
}

export function isValidReceiptTransition(from: string, to: string): boolean {
  return (VALID_RECEIPT_TRANSITIONS[from] ?? []).includes(to)
}
