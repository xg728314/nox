/**
 * Product scope flags (2026-05-03).
 *
 * NOX 는 단일 건물 (5~8층 14매장 + 3층 카페) 운영을 위해 만들어진 시스템이다.
 * 다국적 프랜차이즈 본사용 인프라(다중 법인, 다국어, 글로벌 통화, 센트럴 KDS,
 * 본사-가맹 회계 통합)는 명시적으로 scope 밖.
 *
 * 이 모듈의 flag 들은 UI/route 분기 가드에 사용된다. 잘못 켜져 있으면
 * 미완성 UI 가 사용자에게 노출돼 운영 장애가 된다.
 *
 * 변경 시: 운영자(super_admin) 합의 + 관련 round 승인 후에만.
 */

export const SCOPE = {
  /** 단일 건물 (multi-store-per-building) 운영. 절대 false 로 두지 말 것. */
  SINGLE_BUILDING: true,

  /**
   * 프랜차이즈 본사용 부가 기능 (loyalty_members, coupons, vendors,
   * purchase_orders, supply_lots, employee_shifts, business_hours, holidays,
   * business_info, combo_sets, daily_closings 등 mig 118 family).
   *
   * 2026-05-03: false. 단일매장 결정으로 build out 보류.
   *   스키마 테이블은 DB 에 유지 (롤백 비용 회피) — 다만 UI/route 노출 금지.
   */
  FRANCHISE_FEATURES: false,

  /** 다국어 (i18n). 단일매장 한글 전용. */
  MULTI_LOCALE: false,

  /** KDS (Kitchen Display System) — 카페 단일 매장 POS 출력으로 충분. */
  KDS_DISPLAY: false,
} as const

/** Type-safe lookup. */
export function isFeatureOn(name: keyof typeof SCOPE): boolean {
  return SCOPE[name] === true
}
