/**
 * 카페 (3층) 도메인 타입.
 *
 * 운영 흐름:
 *   - 5~8층 매장 (호스티스/실장/사장/스태프) 가 주문 → 3층 카페가 받음.
 *   - 호스티스가 룸채팅에서 주문하면 그 룸이 자동 배달 위치.
 *   - 그 외 사용자는 자유 텍스트로 위치 입력.
 *   - 결제: 계좌 입금 또는 수령 시 카드결제.
 *
 * NOX 기존 도메인과의 분리 원칙:
 *   - 카페 매출은 NOX 의 가게 매출/정산 (orders / receipts) 과 무관.
 *   - cafe_orders 는 자체 lifecycle (pending → preparing → delivering → delivered).
 *   - 카페 store_uuid 는 stores 테이블 사용하되 floor=3 으로 분리.
 */

export type CafeMenuItem = {
  id: string
  store_uuid: string
  name: string
  category: string
  price: number
  description: string | null
  description_long: string | null  // 상세 페이지 긴 설명
  image_url: string | null         // 큰 이미지
  thumbnail_url: string | null     // 카드용 썸네일 (없으면 image_url 재사용)
  is_active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

/** 옵션 그룹 (예: 샷 / 시럽 / 사이즈). max_select=1 단일선택, 2+ 다중선택. */
export type CafeMenuOptionGroup = {
  id: string
  menu_id: string
  name: string
  is_required: boolean
  min_select: number
  max_select: number
  sort_order: number
  is_active: boolean
  options?: CafeMenuOption[]   // 클라이언트 enrichment
}

export type CafeMenuOption = {
  id: string
  group_id: string
  name: string
  price_delta: number
  is_default: boolean
  sort_order: number
  is_active: boolean
}

// ─── 소모품 (R-Cafe-Supplies) ────────────────────────────────

export type CafeSupply = {
  id: string
  store_uuid: string
  name: string
  category: string | null
  unit: string                // '개' / 'g' / 'ml' / 'kg' / 'l'
  current_stock: number       // numeric → JS number
  min_stock: number
  unit_cost: number | null
  is_active: boolean
  notes: string | null
  created_at: string
  updated_at: string
}

export type CafeSupplyPurchase = {
  id: string
  store_uuid: string
  supply_id: string
  qty: number
  unit_cost: number | null
  total_cost: number | null
  vendor: string | null
  purchased_by: string | null
  purchased_at: string
  notes: string | null
  created_at: string
}

export type CafeSupplyLedger = {
  id: string
  store_uuid: string
  supply_id: string
  delta: number
  reason: "purchase" | "order" | "adjust" | "waste"
  ref_table: string | null
  ref_id: string | null
  resulting_stock: number
  membership_id: string | null
  notes: string | null
  created_at: string
}

export type CafeMenuRecipeLine = {
  id: string
  menu_id: string
  supply_id: string | null    // NULL = 정보 라인 (차감 안 함)
  display_name: string | null
  qty: number
  unit: string | null
  note: string | null
  sort_order: number
  is_active: boolean
}

export type CafeReview = {
  id: string
  store_uuid: string
  menu_id: string | null
  customer_membership_id: string
  order_id: string | null
  rating: number       // 1~5
  text: string | null
  created_at: string
  // enrich
  customer_name?: string | null
  menu_name?: string | null
}

export type CafeAccountInfo = {
  store_uuid: string
  bank_name: string | null
  account_number: string | null
  account_holder: string | null
  is_active: boolean
  updated_at: string
}

/** 주문 상태 lifecycle. */
export type CafeOrderStatus =
  | "pending"      // 주문 들어옴, 카페 미확인
  | "preparing"    // 카페 준비 중
  | "delivering"   // 배달 출발
  | "delivered"    // 수령 완료
  | "cancelled"    // 취소
  | "credited"     // 배달은 됐는데 외상 (cafe_order_credits 에 row 있음). 회수 시 delivered 로 복귀.

export type CafePaymentMethod =
  | "account"            // 계좌 입금 (선결제 또는 후입금)
  | "card_on_delivery"   // 수령 시 카드결제

/** items jsonb 스키마. menu_id 보존 (메뉴 삭제돼도 historical 가격 유지). */
export type CafeOrderItem = {
  menu_id: string
  name: string
  price: number          // 메뉴 base price (옵션 미포함) snapshot
  qty: number
  /** 옵션 선택 (옵션 ID + 가격 가산 + 이름 snapshot). */
  options?: Array<{
    option_id: string
    name: string
    price_delta: number
  }>
  /** 한 단위 옵션 합산. price + sum(options.price_delta). UI 가 편하라고 미리 계산. */
  unit_price?: number
}

export type CafeOrder = {
  id: string
  cafe_store_uuid: string
  customer_store_uuid: string
  customer_membership_id: string
  delivery_room_uuid: string | null
  delivery_session_id: string | null
  delivery_text: string | null
  items: CafeOrderItem[]
  subtotal_amount: number
  payment_method: CafePaymentMethod
  status: CafeOrderStatus
  paid_at: string | null
  delivered_at: string | null
  delivered_by: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

/** 새 주문 입력 (POST). */
export type CafeOrderCreateInput = {
  cafe_store_uuid: string
  items: Array<{
    menu_id: string
    qty: number
    /** 선택한 option_id 목록 (group 별 enforced 는 서버 검증). */
    option_ids?: string[]
  }>
  payment_method: CafePaymentMethod
  /** 룸 배달일 때. 둘 다 있어야 함. */
  delivery_room_uuid?: string | null
  delivery_session_id?: string | null
  /** 자유 위치 (룸 배달 아닐 때). */
  delivery_text?: string | null
  notes?: string | null
}

/** 카페 owner 가 받는 inbox 화면 행. */
export type CafeOrderInboxRow = CafeOrder & {
  customer_store_name: string
  customer_name: string | null
  delivery_room_name: string | null
}
