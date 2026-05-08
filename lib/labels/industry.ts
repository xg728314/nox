/**
 * NOX 웹 사용자 (nox.ai.kr) — 기존 사용자에게 익숙한 industry 라벨.
 *
 * 적용 시점:
 *   - NEXT_PUBLIC_BUILD_MODE !== "app" (default).
 *   - 기존 nox.ai.kr 운영 매장 — 이 라벨이 default.
 *
 * 점주 매장 설정에서 본인 매장만의 라벨로 override 가능.
 *
 * 키는 default.ts 와 일치해야 함 — 새 키 추가 시 양쪽 모두 추가.
 */

import type { LabelKey } from "./default"

export const INDUSTRY_LABELS: Record<LabelKey, string> = {
  // ── 직책 ─────────────────────────────────────────────────────
  manager: "실장",
  manager_short: "실장",
  manager_uppercase: "실장",
  staff: "스태프",
  staff_short: "스태프",
  customer: "손님",
  owner: "사장",

  // ── 서비스 종목 (P=퍼블릭, S=셔츠, H=하퍼) ───────────────────
  service_p: "퍼블릭",
  service_s: "셔츠",
  service_h: "하퍼",
  service_p_short: "퍼블릭",
  service_s_short: "셔츠",
  service_h_short: "하퍼",

  // ── 시간 / 종류 ──────────────────────────────────────────────
  full_time: "완티",
  half_time: "반티",
  extra_time: "차3",
  greeting_check: "인사 확인",

  // ── 정산 / 금액 ──────────────────────────────────────────────
  manager_commission: "실장 수익",
  staff_payout: "스태프 지급액",
  manager_receivable: "실장 받을돈",
  manager_payable: "실장 줄돈",
  store_revenue: "가게 매출",
  store_margin: "사장 마진",
  pre_settlement: "선정산",
  post_settlement: "정산",
  customer_total: "손님 청구",
  participant_total: "타임 매출",
  order_total: "주문 매출",
  liquor_total: "양주 매출",
  waiter_tip: "웨이터팁",

  // ── 결제 / 외상 ──────────────────────────────────────────────
  cash_payment: "현금",
  card_payment: "카드",
  credit_payment: "외상",
  card_fee: "카드 수수료",
  credit: "외상",
  credit_pending: "미수",
  credit_collected: "수금 완료",

  // ── 세션 / 룸 ────────────────────────────────────────────────
  session: "세션",
  room: "방",
  room_short: "방",
  active_session: "사용 중",
  closed_session: "완료",
  checkin: "체크인",
  checkout: "체크아웃",
  mid_out: "중간 퇴실",
  kick: "팅김",
  extend: "연장",

  // ── 영업일 ──────────────────────────────────────────────────
  business_day: "영업일",
  open_day: "영업 중",
  closed_day: "마감 완료",

  // ── 매출 / TC ────────────────────────────────────────────────
  tc_count: "TC 건수",
  tc_amount: "TC 금액",

  // ── 직원 관리 ────────────────────────────────────────────────
  attendance: "출근",
  attendance_check: "출근 확인",
  staff_pool: "스태프 목록",
  staff_chat: "스태프 채팅",

  // ── 알림 / 채팅 ──────────────────────────────────────────────
  global_chat: "매장 전체",
  group_chat: "그룹 채팅",
  direct_chat: "개인 채팅",
}
