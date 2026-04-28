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
}

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
}

// ─── 스태프 시트 (staff) ──────────────────────────────────────
export type StaffSession = {
  time?: string
  store?: string                           // 가게이름 (whitelist 매칭)
  service_type?: ServiceType
  time_tier?: TimeTier
  status?: "완료" | "진행중" | "unknown"
  raw_text?: string
}

export type PaperStaffRow = {
  hostess_name: string
  sessions: StaffSession[]
  daily_totals?: number[]                  // 우측 빨간 합계 (의미: 분 또는 만원 — 매장별 다름)
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
