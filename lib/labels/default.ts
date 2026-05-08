/**
 * NOX 앱스토어 (App Store / Play Store) 배포용 default 라벨.
 *
 * 원칙:
 *   - generic B2B 매장 운영 시스템으로 보이도록.
 *   - 한국어 그대로 유지 (한글 깨지지 않음). 영어 키만 generic 단어 매핑.
 *   - 어떤 산업 (미용실, 헬스장, 스튜디오, 룸 카페) 에서도 통하는 단어.
 *
 * 변경 시:
 *   - INDUSTRY_LABELS (industry.ts) 와 키 일치 필수.
 *   - 새 키 추가는 default.ts → industry.ts 순서.
 */

export const DEFAULT_LABELS = {
  // ── 직책 ─────────────────────────────────────────────────────
  manager: "매니저",
  manager_short: "매니저",
  manager_uppercase: "매니저",
  staff: "스태프",
  staff_short: "스태프",
  customer: "고객",
  owner: "사장",

  // ── 서비스 종목 (Type A/B/C) ─────────────────────────────────
  service_p: "P 이용권",
  service_s: "S 이용권",
  service_h: "H 이용권",
  service_p_short: "P",
  service_s_short: "S",
  service_h_short: "H",

  // ── 시간 / 종류 ──────────────────────────────────────────────
  full_time: "기본",
  half_time: "단축",
  extra_time: "추가시간",
  greeting_check: "고객 응대 확인",

  // ── 정산 / 금액 ──────────────────────────────────────────────
  manager_commission: "매니저 수수료",
  staff_payout: "스태프 지급액",
  manager_receivable: "매니저 수령액",
  manager_payable: "매니저 지급액",
  store_revenue: "매장 매출",
  store_margin: "매장 마진",
  pre_settlement: "선지급",
  post_settlement: "후정산",
  customer_total: "고객 청구액",
  participant_total: "이용권 매출",
  order_total: "주문 매출",
  liquor_total: "메뉴 매출",
  waiter_tip: "서비스 팁",

  // ── 결제 / 외상 ──────────────────────────────────────────────
  cash_payment: "현금",
  card_payment: "카드",
  credit_payment: "후불",
  card_fee: "카드 수수료",
  credit: "후불",
  credit_pending: "미결제",
  credit_collected: "수금 완료",

  // ── 세션 / 룸 ────────────────────────────────────────────────
  session: "세션",
  room: "룸",
  room_short: "방",
  active_session: "이용 중",
  closed_session: "마감",
  checkin: "입장",
  checkout: "퇴장",
  mid_out: "중도 퇴장",
  kick: "취소",
  extend: "시간 연장",

  // ── 영업일 ──────────────────────────────────────────────────
  business_day: "영업일",
  open_day: "영업 중",
  closed_day: "마감 완료",

  // ── 매출 / TC ────────────────────────────────────────────────
  tc_count: "이용 건수",
  tc_amount: "이용 금액",

  // ── 직원 관리 ────────────────────────────────────────────────
  attendance: "출근",
  attendance_check: "출근 확인",
  staff_pool: "스태프 목록",
  staff_chat: "스태프 채팅",

  // ── 알림 / 채팅 ──────────────────────────────────────────────
  global_chat: "매장 전체",
  group_chat: "그룹 채팅",
  direct_chat: "1:1 채팅",
} as const

export type LabelKey = keyof typeof DEFAULT_LABELS
