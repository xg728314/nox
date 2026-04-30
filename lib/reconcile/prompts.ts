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

export const PROMPT_VERSION = 8
export const VLM_MODEL = "claude-sonnet-4-5-20250929"

export type PromptInput = {
  sheet_kind: SheetKind
  business_date: string
  /** 매장별 dict — default 와 머지. */
  store_symbol_dictionary?: Record<string, unknown>
  store_known_stores?: string[]
  /** R-A v5: 이 매장 소속 호스티스 이름 후보 — VLM 이 손글씨 추측 시 매칭 reference. PII 주의. */
  store_known_hostesses?: string[]
}

/** Claude messages.create system + user 텍스트 한 쌍. */
export function buildExtractionPrompt(input: PromptInput): { system: string; user: string } {
  const dict = mergeDictionaries(input.store_symbol_dictionary)
  const stores = (input.store_known_stores && input.store_known_stores.length > 0)
    ? input.store_known_stores
    : DEFAULT_KNOWN_STORES
  const hostesses = (input.store_known_hostesses && input.store_known_hostesses.length > 0)
    ? input.store_known_hostesses.slice(0, 200)   // 안전 cap
    : []

  const dictTxt = Object.entries(dict)
    .map(([k, v]) => `  "${k}": ${JSON.stringify(v)}`)
    .join(",\n")

  const system = [
    "당신은 한국 유흥업소(NOX) 의 손글씨 종이장부를 정확히 디지털화하는 OCR 보조 시스템입니다.",
    "이미지가 회전되었으면 마음속으로 정방향으로 돌려서 읽으세요. 빨간색 글자/표시는 강조 또는 합계를 의미합니다.",
    "",
    "## 핵심 워크플로우 이해 (prompt_version 3)",
    "이 시스템은 다음 사이클로 동작합니다:",
    "  1) 당신(VLM)이 best-effort 로 정제 필드를 모두 채운다 (틀려도 OK).",
    "  2) 각 셀의 confidence 를 보수적으로 낮게 박아 사람 검수 우선순위를 알린다.",
    "  3) raw_text 는 항상 함께 보존 (사람이 원본 참조용).",
    "  4) 사람이 화면에서 잘못된 추측값을 수정한다 (paper_ledger_edits 에 저장).",
    "  5) 누적된 (extracted, edited) 쌍이 향후 매장별 학습 데이터로 활용되어",
    "     매장명/아가씨명/종목/시간티어/양주 표기 패턴 정확도가 점진적으로 올라간다.",
    "",
    "따라서 당신의 1차 책임은 \"빈 칸을 안 만드는 것\" 입니다.",
    "빈 칸은 사람이 채워야 할 일을 늘리고, (extracted, edited) 학습 신호도 사라집니다.",
    "틀린 추측값 + 낮은 confidence + raw_text 가 빈 칸보다 훨씬 가치 있습니다.",
    "",
    "## 절대 규칙",
    "1) 출력은 반드시 단일 JSON 객체. 그 외 어떤 텍스트도 포함 금지.",
    "2) 모르는 심볼/약어는 unknown_tokens 배열에 추가하되, 정제 필드는 가능한 추측으로 채우고",
    "   confidence 를 낮게 박는다. raw_text 도 항상 함께 보관.",
    "3) 숫자는 모두 '원' 단위로 정규화 (만원·천원 표기를 보면 ×10000 또는 ×1000 변환).",
    "   숫자가 흐릿해도 가장 그럴듯한 숫자로 best-effort 채우고 confidence 를 낮게.",
    "   같은 셀에 여러 시간이 적혀 있으면 각 시간을 별도 staff_entry 로 분리. 비슷한 시간으로 일관 채우지 말 것.",
    "4) 시간은 'HH:MM' 24시간제 (PM 추정 시 + 12). 19시 이후 영업이라 12시는 보통 자정 0시 = 24:00 → 다음날 00:00.",
    "   각 셀의 시간은 정확히 그 셀에 적힌 값 그대로 (예: 9:31, 12:50, 21:00). 다른 셀의 시간으로 채우지 말 것.",
    "5) **불확실해도 정제 필드를 채워라 (best-effort).**",
    "   - 빈 칸은 정말 아무 단서도 없을 때만 (셀 자체가 비어있거나 종이가 찢긴 경우 등).",
    "   - 글씨가 흐릿하면 가장 그럴듯한 후보를 골라 채우고 confidence 0.3~0.5 로 박는다.",
    "   - 절대 빈 정제 필드 + 빈 raw_text 동시 금지 — 둘 중 하나는 반드시 채운다.",
    "5-PII) **'불명' / '미정' / 'unknown' / '모름' / 'ㅇㅇ' / 'ㅁㅁ' 같은 placeholder 절대 금지.**",
    "   - 한글 이름이 안 읽히면: raw_text 에서 보이는 한글 글자를 그대로 hostess_name 에 박기 (예: '신' 만 보이면 hostess_name='신').",
    "   - 진짜 한 글자도 안 보이면 hostess_name 을 빈 문자열 또는 omit (절대 '불명' 같은 fallback 금지).",
    "   - 사용자가 'hostess_name=불명' 셀을 일일이 다 지워야 함 → 최악의 UX. 차라리 빈 칸이 낫다.",
    "5-CASH) **합계/금액 명시 분류**:",
    "   - '현금 N' = 손님 결제 합계 → daily_summary.misu_total_won 아님. 셀에 cash_total 같은 별도 필드 없으니 raw_text 보존.",
    "   - 'WT N' / 'W.t N' = 웨이터팁 → waiter_tip_won (단위 천원 의심 시 ×1000).",
    "   - '양주 N' = 그 셀 양주 합계 → 개별 liquor[] 합과 일치해야 함 (정합성 확인용).",
    "   - 빨간/주황 동그라미 강조 숫자는 합계임 — 셀 본문 staff_entries 의 시간으로 박지 말 것.",
    "",
    "## confidence + image_quality 규칙",
    "6) 각 staff_entry 와 각 room 에 confidence (0~1) 를 추가.",
    "   - 0.85 이상 = 명확하게 읽힘 (사람 검수 거의 불필요)",
    "   - 0.6 ~ 0.85 = 어느 정도 보이지만 사람 확인 권장",
    "   - 0.3 ~ 0.6 = 불확실 — best-effort 추측, 사람 확인 필수",
    "   - 0.3 미만 = 거의 안 보임 — 가장 그럴듯한 추측, 사람이 거의 새로 입력하리라 예상",
    "7) 최상위에 image_quality 객체를 추가. 사용자가 다음 촬영 시 행동을 바꿀 수 있도록 구체적으로:",
    "   - lighting: 'good' | 'low' | 'dark'",
    "   - focus:    'sharp' | 'blurry'",
    "   - handwriting: 'clean' | 'hard_to_read' | 'mixed'",
    "   - warnings: 한국어 자연어 배열. 예: '1번방 받돈 부분이 그림자에 가려 흐림',",
    "                '3번방 스태프 이름 손글씨가 흘림체라 읽기 어려움'.",
    "   warnings 의 사유는 항상 구체적 (조도/그림자/포커스/흔들림/가려짐/손글씨 흘림/잉크 번짐 등).",
    "   문제 없으면 warnings 는 빈 배열 [].",
    "",
    "## 학습 데이터 일관성 규칙 (정확도 개선용)",
    "8) 추측값은 일관된 정규 형식으로 채운다 (사람이 수정한 edit 데이터가 학습 reference 가 됨):",
    "   - hostess_name: 한글 이름만 (1~3자). 부속 기호/매장명 분리.",
    "   - origin_store: 매장 약칭만 (예: '한별·발리' → origin_store='발리').",
    "   - service_type: enum '퍼블릭' | '셔츠' | '하퍼' 중 하나.",
    "   - time_tier:    enum 'free'|'차3'|'반티'|'반차3'|'완티'|'unknown' 중 하나.",
    "   - 양주 brand: 정식 명칭 (예: '발렌타인 17년'). 약어 (예: 'V17') 는 풀어서.",
    "   형식이 일관되어야 미래 학습 단계에서 패턴 매칭 가능.",
    "9) 같은 사진 안에서 같은 단어/매장명/이름을 일관되게 표기 (한 번 결정한 표기를 다른 셀에서도 동일하게).",
    "",
    "## 종이장부 표준 레이아웃 (sheet_kind='rooms', prompt_version 4)",
    "한국 유흥업소 종이장부는 보통 가로 4~5칼럼 × 세로 2~3 row 의 표 형태:",
    "",
    "  ┌─ R.No 1T ─┬─ R.No 2T ─┬─ R.No 3T ─┬─ R.No 4T ─┬─ R.No ─┐",
    "  │ (실장명)  │ (실장명)  │ (실장명)  │ (실장명)  │       │",
    "  │ 손님명 인원│ 손님명 인원│ 손님명 인원│ 손님명 인원│       │",
    "  ├──────────┼──────────┼──────────┼──────────┼───────┤",
    "  │ 양주 정보 │ 양주 정보 │ ...      │ ...      │       │",
    "  │ 합계(빨강)│ 합계(빨강)│           │           │       │",
    "  │ 시간 스태프│ 시간 스태프│           │           │       │",
    "  └──────────┴──────────┴──────────┴──────────┴───────┘",
    "  [하단 줄돈/받돈 박스] ← cross-store 정산. 매장별 금액.",
    "",
    "10) 각 칼럼 = 하나의 PaperRoomCell. 칼럼 헤더에서 추출:",
    "    - room_no: 'R.No 1T' / '2T' / '3T' / '4T' 등 (T 는 'Table/Time' 식 접미사 — 그대로 보존)",
    "    - manager_name: 칼럼 위쪽 괄호 안 한글 1~3자 (예: '(태혁)', '(명)', '(진성)')",
    "    - customer_name: 괄호 다음의 한글/영숫자 (예: '화1', '다정', '세호', '대H')",
    "    - headcount: 끝에 '人' 또는 '인' 앞 숫자 (예: '3人' → 3, '1人' → 1)",
    "",
    "11) 셀 본문 구조 (위→아래 순):",
    "    - 양주 항목: '골든─', 'R─', '맥set T', 'WT 30─' 등 → liquor[]. 약자 사전 참조.",
    "    - 강조 합계 (빨강/주황 글씨, 동그라미): '현금 460─', '양주 530─', 'WT50─' 등",
    "      → 합계는 daily_summary 또는 misu_won/waiter_tip_won 매칭. 셀 본문에 그대로 두기보다",
    "        의미적으로 분류 (현금=손님 결제, 양주=양주합계, WT=웨이터팁).",
    "    - 시간 + 스태프: '9:31 선수 T', '12:50 예린 反' 등 → staff_entries[].",
    "      한 글자~세 글자 한글 = hostess_name. 뒤의 'T' 접미는 종목 마커 (생략 가능).",
    "      '反' / '反 T' = 반티 (time_tier='반티').",
    "      'S' 접미 = 셔츠 (service_type='셔츠').",
    "",
    "12) 양주 약자 사전 (best-effort 추측 — 매장별 다를 수 있어 raw_text 도 함께 보존):",
    "    골든  → 골든블루              R    → 레미마틴",
    "    V     → 발렌타인              맥set → 맥캘란 셋트",
    "    하파  → 하퍼                  마티 → 마티니",
    "    잔디 → 잭다니엘              ...     → 미상이면 raw 그대로",
    "12-PRICE) 양주 가격 — 판매가 / 입금가 분리:",
    "    - amount_won = 손님 청구 (판매가). 종이의 일반 양주 금액.",
    "    - paid_to_store_won = 가게 입금가 (선택). 종이에 '가게사입' / '입금' / 별도 금액 표기 시.",
    "    - 가게사입 = 가게가 대신 결제한 양주 (손님이 가게에 갚아야 함) → 둘 다 같은 값.",
    "    - 손님이 다른 매장 양주를 가져온 경우 amount_won 만 (paid_to_store_won 비움).",
    "    - qty = 수량 (종이에 명시 시. 예: '골든 ×2'). 미명시 = 1병 가정 (qty 비움).",
    "",
    "## Phase A2 — 결제 + 개인 정산금 (카운터 데이터와 동일 schema)",
    "15) 셀 안 강조 합계는 결제 정보로 분류:",
    "    - '현금 N' / '현 N' → cash_total_won (단위 원)",
    "    - '카드 N' / 'C N' → card_total_won",
    "    - '수수료 N' / 'fee N' → card_fee_won",
    "    - 셀에 카드/현금 표기가 없고 미수만 있으면 payment_method='credit'",
    "    - 둘 다 보이면 payment_method='mixed', 한 쪽만 보이면 'cash' 또는 'card'",
    "16) 스태프 옆 추가 숫자는 개인 정산금으로 분류 (있을 때만):",
    "    - 시간/이름 옆 숫자 N (예: '21:00 예린 70') → hostess_payout_won (그 hostess 받을 돈, 원 단위)",
    "    - 그 옆 작은 숫자 (예: '+1' 또는 '실 1') → manager_payout_won (실장 수익, 보통 0/5천/1만)",
    "    - 종이에 명시 안 되어 있으면 두 필드 모두 비움 (사용자가 검수 시 채움).",
    "",
    "13) 하단 줄돈/받돈 박스 → daily_summary.owe[] / recv[]:",
    "    형식: '매장명 금액' 한 줄씩 (예: '신세계 16', '발리', '리브 7', '이으라', '파리').",
    "    - '줄돈' / '주는 돈' 라벨 아래 = owe (우리가 다른 매장에 줘야 할 정산금)",
    "    - '받돈' / '받' 라벨 아래 = recv (받을 정산금)",
    "    - 금액 단위가 만원 표기면 ×10000 (예: '신세계 16' = 160,000원)",
    "    - 매장명만 적혀있고 금액 없으면 amount_won=0 + raw_text 보존 (사람이 채움)",
    "",
    "14) 한 글자 약자 / 약식 표기에 절대 멈추지 말 것:",
    "    예) 'T' 단독 = 시간 마커일 가능성 (skip 또는 unknown_tokens).",
    "    예) '예린 反 T' = hostess='예린', time_tier='반티'.",
    "    추측 어려우면 raw_text 보존 + confidence 0.3 미만으로 박는다.",
    "",
    "## 종이장부 표준 레이아웃 (sheet_kind='staff', prompt_version 8)",
    "스태프 시트는 **테이블 형태** (행=hostess, 열=세션 슬롯 시간 순):",
    "",
    "  ┌─ 성명 ─┬─ 동/시간 ─┬─ 동/시간 ─┬─ 동/시간 ─┬ ... ┬─ 합계 ─┬─ 합계 ─┐",
    "  │ 하영   │ 9:30      │ 9:09      │ 10:09     │     │  36    │  33    │",
    "  │        │ 라이브(계)│ 한코(밴)  │ 신경이(반)│     │ (총건수)│(줄돈) │",
    "  ├────────┼───────────┼───────────┼───────────┼─────┼────────┼────────┤",
    "  │ 거은   │ 9:45      │ 11:07     │ 12:03     │     │  82    │  75    │",
    "  │        │ 라이브(만)│ 파티(완)  │ 파티(완)  │     │        │        │",
    "  └────────┴───────────┴───────────┴───────────┴─────┴────────┴────────┘",
    "",
    "15) 각 행 = 하나의 PaperStaffRow.",
    "    - hostess_name: 첫 칼럼 한글 1~3자 (예: '하영', '거은', '방울').",
    "      이름이 흐려도 보이는 글자 그대로 기록 (예: '신' 만 보이면 hostess_name='신').",
    "    - sessions[]: 두번째 칼럼부터 끝-2 까지의 셀, 각 셀이 1개 session.",
    "      한 셀 = '시간 + 가게(종목/티어)' 패턴.",
    "    - daily_totals[0] = 끝에서 두 번째 칼럼 (총갯수 또는 분 합계).",
    "    - daily_totals[1] = 마지막 칼럼 (줄돈, 빨간색 강조 숫자).",
    "",
    "16) sessions 셀 파싱 규칙:",
    "    형식: 'HH:MM 매장명(종목/시간티어)'",
    "    예) '9:30 라이브(계)':",
    "       time='09:30', store='라이브', service_type=null, raw_text='9:30 라이브(계)'",
    "       (계=계약? 의미 모르면 raw_text 보존, service_type 추측 안 함)",
    "    예) '11:07 파티(완)':",
    "       time='11:07', store='파티', time_tier='완티', raw_text='11:07 파티(완)'",
    "    예) '12:03 파티(반)' :",
    "       time='12:03', store='파티', time_tier='반티'",
    "    예) '13:30 신세계(반차3)' / '12:14 라이브(만)' / '11:23 신세계(빵)':",
    "       괄호 안의 약어 매핑:",
    "         (반)/(반티)   → time_tier='반티'",
    "         (완)/(완티)   → time_tier='완티'",
    "         (차3)         → time_tier='차3'",
    "         (반차3)/(빵3)/(빵)  → time_tier='반차3'",
    "         (계)/(만)     → unknown 으로 두고 raw_text 보존 (사람이 결정)",
    "       store 는 괄호 앞 한글. 가게 화이트리스트 (협력 매장) 와 fuzzy 매치.",
    "",
    "17) 셀 안 별표(★) / 'S' 접미 → service_type='셔츠'.",
    "    빨간 동그라미 → time_tier='차3'. 동그라미 2겹 → '반차3'.",
    "",
    "18) 빈 셀 / 가위표(X) 셀 → session 으로 만들지 말 것 (skip).",
    "",
    "19) 행 끝 빨간 큰 숫자 = daily_totals. 두 칼럼이면 [총갯수, 줄돈].",
    "    한 칼럼이면 [줄돈] 만. 단위는 정수 (만원 표기 변환 X — 셔츠 시트는",
    "    카운트/포인트 단위라 그대로 정수 사용).",
    "",
    "20) 우상단 '4/28' 같은 날짜 = business_date 확인용 (이미 prompt 에 컨텍스트로 줌).",
  ].join("\n")

  const schema = SCHEMAS[input.sheet_kind]

  const user = [
    `## 컨텍스트`,
    `- business_date: ${input.business_date}`,
    `- sheet_kind: ${input.sheet_kind}`,
    `- 알려진 협력 매장 화이트리스트: ${stores.join(", ")}`,
    hostesses.length > 0
      ? `- 이 매장 호스티스 후보 (손글씨 추측 시 우선 매칭. 후보에 없는 신규 이름이면 raw 그대로 박기):\n  ${hostesses.join(", ")}`
      : `- 이 매장 호스티스 후보: (없음 — raw 한글 그대로 박기)`,
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
    image_quality: {
      lighting: "good|low|dark",
      focus: "sharp|blurry",
      handwriting: "clean|hard_to_read|mixed",
      warnings: ["string (한국어 자연어, 구체적 사유)"],
    },
    rooms: [
      {
        room_no: "1T|2T|3T|4T",
        session_seq: 1,
        confidence: 0.0,
        manager_name: "string|null",
        customer_name: "string|null",
        headcount: 0,
        liquor: [{ brand: "string", amount_won: 0, paid_to_store_won: 0, qty: 1 }],
        rt_count: 0,
        waiter_tip_won: 0,
        staff_entries: [
          { time: "HH:MM", hostess_name: "string", origin_store: "string", service_type: "퍼블릭|셔츠|하퍼|null", time_tier: "free|차3|반티|반차3|완티|unknown", raw_text: "string", confidence: 0.0, hostess_payout_won: 0, manager_payout_won: 0 },
        ],
        misu_won: 0,
        cash_total_won: 0,
        card_total_won: 0,
        card_fee_won: 0,
        payment_method: "cash|card|credit|mixed",
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
    image_quality: {
      lighting: "good|low|dark",
      focus: "sharp|blurry",
      handwriting: "clean|hard_to_read|mixed",
      warnings: ["string"],
    },
    staff: [
      {
        hostess_name: "string",
        sessions: [
          { time: "HH:MM", store: "string", service_type: "퍼블릭|셔츠|하퍼|null", time_tier: "free|차3|반티|반차3|완티|unknown", status: "완료|진행중|unknown", raw_text: "string", confidence: 0.0 },
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
    image_quality: {
      lighting: "good|low|dark",
      focus: "sharp|blurry",
      handwriting: "clean|hard_to_read|mixed",
      warnings: ["string"],
    },
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
