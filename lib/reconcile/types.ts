/**
 * R27~R30: 종이장부 ↔ NOX 대조 시스템 공용 타입.
 *
 * 변경 시 주의:
 *   - PaperExtraction 은 DB jsonb 에 저장됨. 필드 추가는 안전하지만 제거/이름변경
 *     은 마이그레이션 필요. prompt_version 도 같이 +1.
 *   - VLM 응답 검증 (lib/reconcile/extract.ts) 이 이 타입을 기준으로 함.
 */

// ─── 도메인 enum ──────────────────────────────────────────────
export type ServiceType = "퍼블릭" | "셔츠" | "하퍼"
export type TimeTier =
  | "free"        // 0~8분
  | "차3"
  | "반티"
  | "반차3"
  | "완티"
  | "unknown"     // VLM 이 분류 못함 → 사람 확인 필요

export type SheetKind = "rooms" | "staff" | "other"
export type SnapshotStatus =
  | "uploaded"
  | "extracting"
  | "extracted"
  | "extract_failed"
  | "edited"        // R-B (예정): 사람-편집 결과 저장 시 박힘
  | "reviewed"

export type MatchStatus = "pending" | "match" | "partial" | "mismatch" | "no_db_data"

// ─── 방별 시트 (rooms) ────────────────────────────────────────
export type RoomLiquor = {
  brand: string             // "골든블루", "거제새벽" 등
  /** 손님 청구 (판매가). 종이의 일반 양주 가격. 만원 단위 X — 원 단위로 정규화. */
  amount_won: number
  /** Phase A: 가게 입금가 (가게사입 등). 종이에 별도 적힌 경우만. 단위 원. */
  paid_to_store_won?: number
  /** Phase A: 수량 (종이에 명시 시). 미명시 = 1병 가정. */
  qty?: number
}

export type RoomStaffEntry = {
  time?: string             // "11:08", "10:50" 등 24h "HH:MM" 또는 12h
  hostess_name?: string
  origin_store?: string     // 한별·발리 의 발리
  service_type?: ServiceType
  time_tier?: TimeTier
  raw_text?: string         // 원본 셀 텍스트 (디버깅 + 사람 확인용)
  /** R-A: VLM 자체 신뢰도 0~1. 사람 검수 우선순위 결정용. optional. */
  confidence?: number
  /** Phase A2: 그 hostess 가 받을 개인 정산금 (원). 카운터의 hostess_payout_amount 매핑. */
  hostess_payout_won?: number
  /** Phase A2: 그 row 에서 실장이 가져갈 수익 (원). 카운터 정책상 0/5천/1만. */
  manager_payout_won?: number
  /**
   * R-AutoPrice (2026-05-01): 종이장부의 "1개반/2개반/3개반" 같은 복합 표기 정규화.
   *   qty_full = 정식타임(완티) 횟수, has_half = 반티 1번 추가 여부.
   *   server post-process 가 origin_store + service_type 으로 store_service_types
   *   조회해 hostess_payout_won 자동 환산. 운영자가 금액 안 적었어도 정확.
   *
   *   예시:
   *     "한나 1개반"  → qty_full=1, has_half=true   (퍼블릭=130k+70k=200k)
   *     "가은 3개반"  → qty_full=3, has_half=true   (셔츠=140k×3+70k=490k)
   *     "라원 2개반"  → qty_full=2, has_half=true   (셔츠=140k×2+70k=350k)
   *     "아영 반티"   → qty_full=0, has_half=true   (하퍼 반티=60k)
   *     "완티" / "2개" → qty_full=N, has_half=false
   *     "차3"          → qty_full=0, has_half=false (time_tier="차3" 별도 처리)
   */
  qty_full?: number
  has_half?: boolean
}

export type PaymentMethod = "cash" | "card" | "credit" | "mixed"

export type PaperRoomCell = {
  room_no: string                          // "1T", "2T", "3T", "4T"
  session_seq: number                      // 같은 방 두 번이면 1, 2
  manager_name?: string                    // (태혁), (준성) 등
  customer_name?: string                   // 세호, 아아 등
  headcount?: number                       // 2人 → 2
  liquor?: RoomLiquor[]                    // 골든블루 외에도 가게사입 (거제새벽 등)
  rt_count?: number                        // 룸티 1, 2 (한자 一/二)
  waiter_tip_won?: number                  // WT 30 = 30000원
  staff_entries?: RoomStaffEntry[]
  misu_won?: number                        // 외상
  raw_text?: string
  /** R-A: 방 단위 종합 신뢰도 0~1. UI 가 카드 색깔로 우선순위 표시. optional. */
  confidence?: number
  /** Phase A2: 결제 정보 (카운터의 receipts.payment_method + amounts 매핑). */
  cash_total_won?: number
  card_total_won?: number
  card_fee_won?: number
  payment_method?: PaymentMethod
  /**
   * R-AutoPrice (2026-05-01): "가게 입금 149만" 처럼 손님 결제액 (계좌/현금)
   *   중에 가게로 실제 입금된 금액. cash_total_won (= 계좌 186만, 손님이
   *   결제한 총액) 과 별개. 차이 = 외부매장 줄돈 직지급 + 양주 가게사입 등.
   */
  store_deposit_won?: number
}

// ─── 검증 결과 (R-AutoPrice 2026-05-01) ───────────────────────
/**
 * 운영자가 종이에 적은 합계와 시스템이 자동 환산한 합계를 비교한 결과.
 * 차이 발생 시 UI 가 "16만원 차이" 식으로 표시 → 운영자가 어디 틀렸는지 즉시 인지.
 */
export type RoomValidation = {
  room_no: string
  /** 양주 합계 (liquor[*].amount_won 합). */
  liquor_total_won: number
  /** 스태프 줄돈 합계 (staff_entries[*].hostess_payout_won 합). */
  staff_payout_total_won: number
  /** 웨이터팁. */
  waiter_tip_won: number
  /** 자동 계산된 손님 청구 예상액 (양주 + 스태프 + 팁). */
  expected_customer_total_won: number
  /** 운영자가 적은 cash_total_won (계좌). */
  paper_cash_total_won: number | null
  /** paper - expected. + 면 운영자 적은 금액이 큼. */
  cash_total_diff_won: number | null
  /** 가게 실제 입금액. */
  paper_store_deposit_won: number | null
  /** cash - deposit (직지급/사입 추정 차액). */
  cash_minus_deposit_won: number | null
  /**
   * R-AutoPrice 추가: 실장수익 = cash_total_won - store_deposit_won.
   *   "다운 실장이 손님한테 받아서 가게에 입금한 후 본인이 가져간 금액".
   *   양 쪽 다 있을 때만 의미 있음.
   */
  manager_profit_won: number | null
  /** 사람이 봐야 할 경고. */
  warnings: string[]
}

export type OweValidation = {
  store_name: string
  /** 종이 줄돈 박스 금액. */
  paper_won: number
  /** staff_entries[origin_store=X].hostess_payout_won 합계. */
  computed_won: number
  /** paper - computed. */
  diff_won: number
}

export type ExtractionValidation = {
  rooms: RoomValidation[]
  /** owe[store] 박스 vs staff_entries 합계 비교. */
  owe_per_store: OweValidation[]
  /** 모든 차이 합 (참고용). */
  total_warnings: number
}

// ─── 스태프 시트 (staff) ──────────────────────────────────────
export type StaffSession = {
  time?: string
  store?: string                           // 가게이름 (whitelist 매칭)
  service_type?: ServiceType
  time_tier?: TimeTier
  status?: "완료" | "진행중" | "unknown"
  raw_text?: string
  /** R-staff-display (2026-04-30): VLM 자체 신뢰도. 추출 schema 에는 항상
   *  포함되지만 type 에 누락됐던 필드. UI 가 ConfidenceBadge 표시. */
  confidence?: number
}

export type PaperStaffRow = {
  hostess_name: string
  sessions: StaffSession[]
  daily_totals?: number[]                  // 우측 빨간 합계 (의미: 분 또는 만원 — 매장별 다름)
  /**
   * R-staff-editor (2026-04-30): 담당 실장. 운영자 검수 시 dropdown 으로
   * 선택. 저장 시 paper_ledger_edits 에 포함되어 향후 정산/PnL 연동에
   * 사용. AI 가 자동으로 채우지 않음 — 운영자가 매핑 결정.
   */
  manager_membership_id?: string | null
  /** R-staff-editor: hostess_name 의 membership_id (선택. 매핑된 경우만). */
  hostess_membership_id?: string | null
}

// ─── 우측 합계 박스 (양 시트 공통) ────────────────────────────
export type CrossStoreSummary = {
  store_name: string                       // "토끼", "황진이", "라이브" 등
  amount_won: number                       // 항상 원 단위로 정규화 (만원 → ×10000)
  raw_text?: string
}

export type PaperDailySummary = {
  owe: CrossStoreSummary[]                 // 줄돈
  recv: CrossStoreSummary[]                // 받돈
  liquor_total_won?: number                // 양주 합계 (전 셀 합산)
  misu_total_won?: number                  // 미수 합계
}

// ─── 이미지 품질 / 인식 한계 (R-A) ────────────────────────────
/** VLM 이 사진 자체의 품질을 평가. 사용자가 다음 촬영 행동을 바꿀 수 있도록
 *  구체적 사유 (조도/포커스/손글씨) 와 자연어 warnings 를 함께 받음. */
export type ImageQualityHints = {
  lighting?: "good" | "low" | "dark"
  focus?: "sharp" | "blurry"
  handwriting?: "clean" | "hard_to_read" | "mixed"
  /** 한국어 자연어. 예: "1번방 받돈 부분이 그림자에 가려 흐림". UI 가 그대로 표시. */
  warnings?: string[]
}

// ─── VLM 추출 최상위 구조 ────────────────────────────────────
export type PaperExtraction = {
  schema_version: 1
  sheet_kind: SheetKind
  business_date?: string                   // "2026-04-24"
  rooms?: PaperRoomCell[]                  // sheet_kind === "rooms"
  staff?: PaperStaffRow[]                  // sheet_kind === "staff"
  daily_summary?: PaperDailySummary
  unknown_tokens: string[]                 // 분류 못한 심볼 — 사람 확인용
  confidence_self_report?: number          // VLM 자체 신뢰도 0~1 (참고용, 전체 평균)
  /** R-A: 이미지 품질 평가 + 셀-단위 자연어 경고. 사용자 가이드 패널 표시용. optional. */
  image_quality?: ImageQualityHints
}

// ─── DB 측 집계 (그날 NOX 데이터) ─────────────────────────────
export type DbDailyAggregate = {
  store_uuid: string
  business_date: string
  // 우리 매장에서 일한 외부 origin_store 별 정산금
  cross_store_owe_by_store: Record<string, number>
  // 우리 아가씨가 다른 매장에서 일해서 받을 정산금
  cross_store_recv_by_store: Record<string, number>
  liquor_total_won: number
  misu_total_won: number
  session_count: number
}

// ─── Diff 결과 ───────────────────────────────────────────────
export type ItemDiff = {
  category: "owe" | "recv" | "liquor_total" | "misu_total"
  key: string                              // store_name 또는 "_total"
  paper_won: number
  db_won: number
  diff_won: number                         // paper - db (+ 면 종이가 큼)
  status: "match" | "mismatch" | "paper_only" | "db_only"
}

export type ReconcileResult = {
  match_status: MatchStatus
  item_diffs: ItemDiff[]
  paper_owe_total_won: number
  paper_recv_total_won: number
  db_owe_total_won: number
  db_recv_total_won: number
  /** 합계 차이가 이 금액 이하면 match 로 간주 (반올림 노이즈 흡수). */
  tolerance_won: number
  computed_at: string
}
