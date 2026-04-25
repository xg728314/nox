/**
 * settlement-tree 공용 에러 코드 → 한국어 메시지 매핑.
 *
 * 서버가 반환하는 `error` 코드를 UI 에 일관된 한국어 문구로 표시하기 위한
 * 단일 출처. 미매칭 코드는 fallback 또는 기본 문구로 처리.
 */

export function mapErrorMessage(code?: string, fallback?: string): string {
  switch (code) {
    case "MANAGER_UNASSIGNED":
    case "MANAGER_NULL":
      return "실장 배정이 필요합니다"
    case "MANAGER_NO_ITEMS":
      return "해당 실장의 정산 대상이 없습니다"
    case "MANAGER_OVERPAY":
      return "실장 정산 금액을 초과했습니다"
    case "STORE_OVERPAY":
      return "매장 전체 정산 금액을 초과했습니다"
    case "AGGREGATE_REQUIRED":
    case "MIGRATION_REQUIRED":
      return "정산 집계를 먼저 실행하세요"
    default:
      return fallback || "오류가 발생했습니다"
  }
}
