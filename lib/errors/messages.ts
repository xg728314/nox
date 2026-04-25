/**
 * 에러 코드 → 한국어 사용자 문구 매핑.
 *
 * 2026-04-24: 여러 페이지에서 "서버 오류", "처리 실패", "등록 실패" 같은
 *   무맥락 문구가 반복 사용되어 사용자가 원인 파악 불가. 서버 API 응답
 *   { error: CODE, message: ... } 의 code 를 이 사전에서 조회해 일관된
 *   설명 표시.
 *
 * 사용:
 *   const res = await apiFetch(...)
 *   const data = await res.json()
 *   setError(errorMessage(data))
 *
 * 신규 코드 추가 원칙:
 *   - 도메인별 prefix 권장 (SESSION_, PAYMENT_, CREDIT_, STAFF_, ...)
 *   - 서버 route 에서 반환하는 { error: CODE } 의 CODE 와 정확히 일치
 *   - 메시지는 사용자 행동 지침 포함 ("~ 후 다시 시도하세요")
 */

export const ERROR_MESSAGES: Record<string, string> = {
  // ── Auth ─────────────────────────────────────────────────────
  AUTH_MISSING: "로그인 정보가 없습니다. 다시 로그인해주세요.",
  AUTH_INVALID: "로그인이 만료되었습니다. 다시 로그인해주세요.",
  MEMBERSHIP_NOT_FOUND: "이 매장에 소속되어 있지 않습니다.",
  MEMBERSHIP_INVALID: "멤버십 정보에 문제가 있습니다. 관리자에게 문의하세요.",
  MEMBERSHIP_NOT_APPROVED: "승인 대기 중인 계정입니다. 승인 후 이용 가능합니다.",
  ROLE_FORBIDDEN: "이 작업을 수행할 권한이 없습니다.",
  SCOPE_FORBIDDEN: "조회 범위 권한이 없습니다.",

  // ── Common ───────────────────────────────────────────────────
  BAD_REQUEST: "요청 형식이 올바르지 않습니다. 입력값을 확인해주세요.",
  INTERNAL_ERROR: "예상치 못한 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
  SERVER_CONFIG_ERROR: "서버 설정 오류입니다. 관리자에게 문의하세요.",
  QUERY_FAILED: "데이터 조회에 실패했습니다. 잠시 후 다시 시도해주세요.",
  NETWORK_ERROR: "네트워크 연결에 문제가 있습니다. 인터넷 상태를 확인하세요.",

  // ── Session lifecycle ────────────────────────────────────────
  SESSION_NOT_FOUND: "세션을 찾을 수 없습니다.",
  SESSION_CONFLICT: "이미 활성 세션이 있습니다. 기존 세션을 먼저 종료하세요.",
  SESSION_NOT_ACTIVE: "세션이 활성 상태가 아닙니다.",
  SESSION_CLOSE_RACE: "동시에 체크아웃이 시도되었습니다. 상태 확인 후 다시 진행하세요.",
  SESSION_CREATE_FAILED: "세션 생성에 실패했습니다.",
  ROOM_NOT_FOUND: "방 정보를 찾을 수 없습니다.",

  // ── Manager (실장) ───────────────────────────────────────────
  MANAGER_INVALID: "지정한 실장이 이 매장의 승인된 실장이 아닙니다.",
  MANAGER_VERIFY_FAILED: "실장 검증에 실패했습니다. 다시 시도해주세요.",

  // ── Settlement / Payment ─────────────────────────────────────
  ALREADY_FINALIZED: "정산이 이미 확정된 세션입니다. 수정하려면 새 버전을 생성하세요.",
  RECEIPT_NOT_FOUND: "정산 내역이 없습니다. 먼저 정산을 생성하세요.",
  RECEIPT_NOT_FINALIZED: "정산이 확정(finalized)된 영수증만 처리 가능합니다.",
  ALREADY_PAID: "이미 결제가 등록된 영수증입니다.",
  AMOUNT_MISMATCH: "결제 금액 합계가 청구 총액과 일치하지 않습니다. 금액 확인 후 재시도하세요.",
  AMOUNT_TOO_LARGE: "입력 금액이 허용 범위를 초과합니다.",
  REMAINDER_NEGATIVE: "정산 잔액이 음수입니다. 실장 + 스태프 지급 합계가 타임 단가를 초과했습니다.",
  PRICING_LOOKUP_FAILED: "단가 설정을 찾지 못했습니다. 매장 설정 → 종목별 단가에서 확인해주세요.",
  CUSTOMER_NAME_REQUIRED: "외상 결제에는 손님 이름이 필수입니다.",
  BUSINESS_DAY_OPEN: "영업일이 마감되지 않았습니다.",
  BUSINESS_DAY_CLOSED: "영업일이 이미 마감되어 수정할 수 없습니다.",
  BUSINESS_DAY_REOPEN_FAILED: "영업일 재개에 실패했습니다.",
  BUSINESS_DAY_CREATE_FAILED: "영업일 생성에 실패했습니다.",

  // ── Archive ──────────────────────────────────────────────────
  ALREADY_ARCHIVED: "이미 숨김 처리된 영수증입니다.",
  ARCHIVE_FAILED: "기록 숨김 처리에 실패했습니다.",

  // ── Credit (외상) ────────────────────────────────────────────
  CREATE_FAILED: "등록에 실패했습니다. 입력값 확인 후 재시도해주세요.",
  UPDATE_FAILED: "수정에 실패했습니다.",
  NOT_FOUND: "해당 항목을 찾을 수 없습니다.",

  // ── Staff / Hostess ──────────────────────────────────────────
  HOSTESS_NOT_FOUND: "스태프를 찾을 수 없습니다.",
  HOSTESS_ROLE_INVALID: "스태프 멤버십이 유효하지 않습니다.",
  ASSIGNMENT_FORBIDDEN: "담당 스태프만 작업 가능합니다.",
  STORE_SCOPE_FORBIDDEN: "소속 매장 스태프만 등록할 수 있습니다.",
  NOT_ASSIGNED: "이 스태프는 본인 담당이 아닙니다.",
  REQUESTER_NOT_FOUND: "요청자를 찾을 수 없습니다.",

  // ── Migration / DB ───────────────────────────────────────────
  MIGRATION_REQUIRED: "DB 마이그레이션 필요. 관리자에게 문의하세요.",

  // ── Audit ────────────────────────────────────────────────────
  AUDIT_WRITE_FAILED: "감사 로그 저장에 실패했습니다.",
}

export type ApiErrorShape = {
  error?: string
  message?: string
  [k: string]: unknown
}

/**
 * API 응답 객체에서 사용자용 문구를 추출.
 * 우선순위: dictionary(code) > server message > fallback.
 */
export function errorMessage(
  data: ApiErrorShape | null | undefined,
  fallback = "예상치 못한 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
): string {
  if (!data) return fallback
  const code = typeof data.error === "string" ? data.error : null
  const serverMsg = typeof data.message === "string" ? data.message : null
  if (code && ERROR_MESSAGES[code]) return ERROR_MESSAGES[code]
  if (serverMsg) return serverMsg
  return fallback
}
