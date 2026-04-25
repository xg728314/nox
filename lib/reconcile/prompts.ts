/**
 * R28: VLM 프롬프트 빌더 — 도메인 어휘를 prompt 에 박아 넣어 정확도 끌어올림.
 *
 * 변경 시 주의: prompt_version 을 +1. 기존 추출과 비교 가능하도록 버전 추적.
 *
 * 프롬프트 구성:
 *   1. 시스템 역할 (한국어 손글씨 종이장부 분석)
 *   2. 도메인 어휘 (★/빨간동/한자 등)
 *   3. JSON schema (응답 강제)
 *   4. unknown 정책 (모르면 unknown_tokens 에 적기)
 */

import type { SheetKind } from "./types"
import { DEFAULT_KNOWN_STORES, DEFAULT_SYMBOL_DICTIONARY } from "./symbols"

export const PROMPT_VERSION = 1
export const VLM_MODEL = "claude-sonnet-4-5-20250929"

export type PromptInput = {
  sheet_kind: SheetKind
  business_date: string
  /** 매장별 dict — default 와 머지. */
  store_symbol_dictionary?: Record<string, unknown>
  store_known_stores?: string[]
}

/** Claude messages.create system + user 텍스트 한 쌍. */
export function buildExtractionPrompt(input: PromptInput): { system: string; user: string } {
  const dict = mergeDictionaries(input.store_symbol_dictionary)
  const stores = (input.store_known_stores && input.store_known_stores.length > 0)
    ? input.store_known_stores
    : DEFAULT_KNOWN_STORES

  const dictTxt = Object.entries(dict)
    .map(([k, v]) => `  "${k}": ${JSON.stringify(v)}`)
    .join(",\n")

  const system = [
    "당신은 한국 유흥업소(NOX) 의 손글씨 종이장부를 정확히 디지털화하는 OCR 보조 시스템입니다.",
    "이미지가 회전되었으면 마음속으로 정방향으로 돌려서 읽으세요. 빨간색 글자/표시는 강조 또는 합계를 의미합니다.",
    "",
    "## 절대 규칙",
    "1) 출력은 반드시 단일 JSON 객체. 그 외 어떤 텍스트도 포함 금지.",
    "2) 모르는 심볼/약어는 절대 추측하지 말고 raw_text 에 원본을 그대로 적고 unknown_tokens 배열에 추가.",
    "3) 숫자는 모두 '원' 단위로 정규화 (만원·천원 표기를 보면 ×10000 또는 ×1000 변환).",
    "4) 시간은 'HH:MM' 24시간제 (PM 추정 시 + 12). 19시 이후 영업이라 12시는 보통 자정 0시 = 24:00 → 다음날 00:00.",
    "5) 글씨가 불확실하면 raw_text 만 채우고 정제 필드는 비워둠.",
  ].join("\n")

  const schema = SCHEMAS[input.sheet_kind]

  const user = [
    `## 컨텍스트`,
    `- business_date: ${input.business_date}`,
    `- sheet_kind: ${input.sheet_kind}`,
    `- 알려진 협력 매장 화이트리스트: ${stores.join(", ")}`,
    "",
    `## 도메인 어휘 (이 의미만 사용. 다른 추측 금지)`,
    "```",
    `{`,
    dictTxt,
    `}`,
    "```",
    "",
    `## 추가 도메인 규칙`,
    "- 종목: 퍼블릭 / 셔츠 / 하퍼",
    "- 시간 등급: free(0-8분) / 차3 / 반티 / 반차3 / 완티",
    "- 빨간 동그라미가 시간/이름 위에 그려져 있으면 'time_tier: 차3'.",
    "- 동그라미 두 개 겹쳐있으면 'time_tier: 반차3'.",
    "- 별표(★) = 셔츠 종목.",
    "- 한자 一/ㅡ = 1, 二/ㅜ = 2 (룸티 횟수 또는 그 방에서의 타임 카운트).",
    "- 시간 뒤 'S' = 셔츠.",
    "- 스태프 칸 형식: '시간 매장이름 종목/등급'. 예: '11:08 발리S' = 11:08 시작, 발리 매장 소속, 셔츠.",
    "- '이름·매장' 형태도 가능 (한별·발리 = hostess_name=한별, origin_store=발리).",
    "- '미수' = 외상. '가게사입' = 가게가 대신 결제한 양주 (손님한테 받아야 함).",
    "- 'WT' / 'W.t' = 웨이터팁. 단위가 천원으로 적혀있을 수 있음 (예: 'WT 30' = 30,000원).",
    "- 양주 금액이 '1,030' 처럼 적혀있으면 천원 단위 = 1,030,000원.",
    "- 우측 합계 박스 '줄돈' = owe (우리가 다른 매장에 줘야 할 돈), '받' = recv (받을 돈). 단위는 만원.",
    "",
    `## 응답 JSON Schema (반드시 이 구조)`,
    "```json",
    schema,
    "```",
    "",
    "## 작업",
    "이미지를 분석해 위 schema 그대로 JSON 으로 응답.",
    "확실치 않은 셀은 raw_text 만 채우고 정제 필드는 빈 값.",
    "결과는 코드블록 없이 raw JSON 만 출력.",
  ].join("\n")

  return { system, user }
}

const SCHEMAS: Record<SheetKind, string> = {
  rooms: JSON.stringify({
    schema_version: 1,
    sheet_kind: "rooms",
    business_date: "YYYY-MM-DD",
    rooms: [
      {
        room_no: "1T|2T|3T|4T",
        session_seq: 1,
        manager_name: "string|null",
        customer_name: "string|null",
        headcount: 0,
        liquor: [{ brand: "string", amount_won: 0 }],
        rt_count: 0,
        waiter_tip_won: 0,
        staff_entries: [
          { time: "HH:MM", hostess_name: "string", origin_store: "string", service_type: "퍼블릭|셔츠|하퍼|null", time_tier: "free|차3|반티|반차3|완티|unknown", raw_text: "string" },
        ],
        misu_won: 0,
        raw_text: "string",
      },
    ],
    daily_summary: {
      owe: [{ store_name: "string", amount_won: 0, raw_text: "string" }],
      recv: [{ store_name: "string", amount_won: 0, raw_text: "string" }],
      liquor_total_won: 0,
      misu_total_won: 0,
    },
    unknown_tokens: ["string"],
    confidence_self_report: 0.0,
  }, null, 2),

  staff: JSON.stringify({
    schema_version: 1,
    sheet_kind: "staff",
    business_date: "YYYY-MM-DD",
    staff: [
      {
        hostess_name: "string",
        sessions: [
          { time: "HH:MM", store: "string", service_type: "퍼블릭|셔츠|하퍼|null", time_tier: "free|차3|반티|반차3|완티|unknown", status: "완료|진행중|unknown", raw_text: "string" },
        ],
        daily_totals: [0, 0],
      },
    ],
    daily_summary: { owe: [], recv: [] },
    unknown_tokens: ["string"],
    confidence_self_report: 0.0,
  }, null, 2),

  other: JSON.stringify({
    schema_version: 1,
    sheet_kind: "other",
    business_date: "YYYY-MM-DD",
    daily_summary: {
      owe: [{ store_name: "string", amount_won: 0 }],
      recv: [{ store_name: "string", amount_won: 0 }],
    },
    unknown_tokens: [],
  }, null, 2),
}

function mergeDictionaries(storeDict?: Record<string, unknown>): Record<string, unknown> {
  return { ...DEFAULT_SYMBOL_DICTIONARY, ...(storeDict ?? {}) }
}
