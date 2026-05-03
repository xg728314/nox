/**
 * parseText — 운영자 자유 텍스트 → PaperExtraction JSON.
 *
 * R-ParseText (2026-05-01):
 *   운영자 의도:
 *     "셀별로 클릭하는 게 더 힘들다.
 *      채팅으로 글 쓰면 NOX 가 알아서 인식하게 만들어라."
 *
 *   사용 예시:
 *     "1번방 다운 준상 2인
 *      골든 3병 병당20만원
 *      계좌 186만원 입금 149만원
 *      신세계6 발리 20 상한가 49 버닝 35
 *      10:05 아영 반 신세계 하퍼"
 *
 * 동작:
 *   1. Anthropic Claude (text-only, vision 미사용) 호출.
 *   2. system + user prompt 로 자유 텍스트 → PaperExtraction JSON.
 *   3. 매장 화이트리스트 / 호스티스 후보 / 학습 사전 prompt 주입.
 *
 * 비용: 페이지당 ~$0.001 (vision 없음, 텍스트만).
 */

import Anthropic from "@anthropic-ai/sdk"
import type { PaperExtraction, SheetKind } from "./types"
import { DEFAULT_KNOWN_STORES } from "./symbols"
import { VLM_MODEL, PROMPT_VERSION } from "./prompts"

export type ParseTextInput = {
  text: string
  sheet_kind: SheetKind
  business_date: string
  store_known_stores?: string[]
  store_known_hostesses?: string[]
  store_learned_corrections_block?: string
}

export type ParseTextResult =
  | {
      ok: true
      extraction: PaperExtraction
      model: string
      prompt_version: number
      duration_ms: number
      cost_usd: number | null
      raw_response_text: string
    }
  | {
      ok: false
      reason: "no_api_key" | "claude_error" | "parse_failed" | "schema_invalid"
      message: string
      duration_ms?: number
      raw_response_text?: string
    }

export async function parseFromText(input: ParseTextInput): Promise<ParseTextResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return { ok: false, reason: "no_api_key", message: "ANTHROPIC_API_KEY env 미설정" }
  }
  if (!input.text || input.text.trim().length < 5) {
    return { ok: false, reason: "parse_failed", message: "텍스트가 너무 짧습니다." }
  }

  const stores = (input.store_known_stores && input.store_known_stores.length > 0)
    ? input.store_known_stores
    : DEFAULT_KNOWN_STORES
  const hostesses = (input.store_known_hostesses && input.store_known_hostesses.length > 0)
    ? input.store_known_hostesses.slice(0, 200)
    : []
  const learnedBlock = (input.store_learned_corrections_block ?? "").trim()

  const system = [
    "당신은 NOX (한국 유흥업소 운영 시스템) 의 종이장부 데이터 입력 보조입니다.",
    "운영자가 한국어 자유 형식 채팅처럼 적은 텍스트를 NOX 의 PaperExtraction JSON 으로 변환합니다.",
    "사진 OCR 이 아니라 운영자가 직접 작성한 정답 텍스트입니다 — 추측이 아닌 정확 변환.",
    "",
    "## 절대 규칙",
    "1) 출력은 단일 JSON 객체. 그 외 어떤 텍스트도 포함 금지.",
    "2) 운영자가 명시한 값은 그대로 보존. 추측 X.",
    "3) 숫자는 모두 '원' 단위로 정규화:",
    "   - '20만원' / '20 만원' = 200,000",
    "   - '186만원' / '186 만원' = 1,860,000",
    "   - '60' (만원 명시 X 인 한 줄돈/매장 금액) = 60,000 (만원 단위 가정)",
    "   - 명백히 원 단위 (예: '480,000원') = 그대로",
    "4) 시간: HH:MM 24시간제.",
    "   - '10:05' / '10시 5분' / '10시05분' → '10:05'",
    "   - '8:31' / '8시31분' → '08:31' (PM 추정 시 +12)",
    "5) 매장명: 약어 → 풀네임 (화이트리스트 fuzzy):",
    "   - '신' / '신세' → '신세계'",
    "   - '발' → '발리'",
    "   - '상한' → '상한가'",
    "   - '버' → '버닝'",
    "6) 시간 등급 (time_tier): 'free' | '차3' | '반티' | '반차3' | '완티' | 'unknown'",
    "   - '반' / '반티' → '반티'",
    "   - '완' / '완티' / '2개' → '완티'",
    "   - '차3' → '차3'",
    "   - '반차3' / '빵' / '빵3' → '반차3'",
    "6-1) ⭐⭐ 복합 표기 (qty_full / has_half) — 운영자가 금액을 안 적었어도 자동 환산:",
    "   staff_entry 마다 qty_full (정식타임 횟수, integer) + has_half (반티 추가, boolean) 항상 채움.",
    "   - '반' / '반티'           → time_tier='반티', qty_full=0, has_half=true",
    "   - '완' / '완티' / '1개'   → time_tier='완티', qty_full=1, has_half=false",
    "   - '2개'                   → time_tier='완티', qty_full=2, has_half=false",
    "   - '3개'                   → time_tier='완티', qty_full=3, has_half=false",
    "   - '1개반'                 → time_tier='완티', qty_full=1, has_half=true",
    "   - '2개반'                 → time_tier='완티', qty_full=2, has_half=true",
    "   - '3개반'                 → time_tier='완티', qty_full=3, has_half=true",
    "   - '차3'                   → time_tier='차3',  qty_full=0, has_half=false",
    "   - '반차3'                 → time_tier='반차3', qty_full=0, has_half=true",
    "   서버가 qty_full × 정식가 + (has_half ? 반티가 : 0) 으로 자동 계산. 따라서 hostess_payout_won 은 0 또는 비워두기 가능.",
    "7) 종목 (service_type): '퍼블릭' | '셔츠' | '하퍼'",
    "   - '퍼' → '퍼블릭', '셔' → '셔츠', '하' → '하퍼'",
    "8) 양주 약자:",
    "   - '골든' → '골든블루', 'R' → '레미마틴', 'V' → '발렌타인',",
    "     '맥set' / '맥' → '맥캘란', '하파' → '하퍼' (양주 brand)",
    "9) 모르는 토큰은 unknown_tokens 배열에 적고 raw_text 보존.",
    "10) confidence: 운영자 정답 텍스트라 기본 0.95 이상. 모호한 값만 0.5~0.7.",
    "",
    "## 입력 예시 → 출력 매핑 가이드",
    "운영자 입력:",
    "  '1번방 다운 준상 2인",
    "   골든 3병 병당20만원",
    "   계좌 186만원 입금 149만원",
    "   신세계6 발리 20 상한가 49 버닝 35",
    "   10:05 아영 반 신세계 하퍼'",
    "",
    "변환:",
    "  rooms[0] = {",
    "    room_no: '1', customer_name: '다운 준상', headcount: 2,",
    "    liquor: [{ brand:'골든블루', qty:3, amount_won:600000 }],   // 3병 × 200,000",
    "    cash_total_won: 1860000,        // '계좌 186만' = 손님이 결제한 총액",
    "    store_deposit_won: 1490000,     // '가게 입금 149만' = 가게에 실제 입금된 금액",
    "    staff_entries: [",
    "      { time:'10:05', hostess_name:'아영', time_tier:'반티', qty_full:0, has_half:true,",
    "        origin_store:'신세계', service_type:'하퍼', confidence:0.95 },",
    "      { time:'10:01', hostess_name:'한나', time_tier:'완티', qty_full:1, has_half:true,",
    "        origin_store:'발리', service_type:'퍼블릭', confidence:0.95 },",
    "      { time:'08:25', hostess_name:'가은', time_tier:'완티', qty_full:3, has_half:true,",
    "        origin_store:'상한가', service_type:'셔츠', confidence:0.95 },",
    "      { time:'08:31', hostess_name:'라원', time_tier:'완티', qty_full:2, has_half:true,",
    "        origin_store:'버닝', service_type:'셔츠', confidence:0.95 }",
    "    ],",
    "    raw_text: '...원본'",
    "  }",
    "  daily_summary.owe = [",
    "    {store_name:'신세계', amount_won:60000},",
    "    {store_name:'발리',   amount_won:200000},",
    "    {store_name:'상한가', amount_won:490000},",
    "    {store_name:'버닝',   amount_won:350000},",
    "  ]",
  ].join("\n")

  const userParts: string[] = [
    `## 컨텍스트`,
    `- business_date: ${input.business_date}`,
    `- sheet_kind: ${input.sheet_kind}`,
    `- 매장 화이트리스트: ${stores.join(", ")}`,
    hostesses.length > 0
      ? `- 호스티스 후보 (이름 매칭 우선): ${hostesses.join(", ")}`
      : `- 호스티스 후보: (없음)`,
    "",
  ]
  if (learnedBlock.length > 0) {
    userParts.push(learnedBlock, "")
  }
  userParts.push(
    `## 운영자 텍스트 (정답)`,
    "```",
    input.text.trim(),
    "```",
    "",
    `## 응답 JSON Schema (반드시 이 구조)`,
    "```json",
    SCHEMAS[input.sheet_kind],
    "```",
    "",
    "## 작업",
    "위 운영자 텍스트를 schema 그대로 JSON 으로 응답.",
    "운영자가 명시한 값은 그대로 보존. confidence 는 기본 0.95 (정답 입력).",
    "결과는 코드블록 없이 raw JSON 만 출력.",
  )
  const user = userParts.join("\n")

  const client = new Anthropic({ apiKey })
  const t0 = Date.now()

  let raw = ""
  let usage: { input_tokens?: number; output_tokens?: number } = {}
  try {
    const resp = await client.messages.create({
      model: VLM_MODEL,
      max_tokens: 16384,
      system,
      messages: [{ role: "user", content: user }],
    })
    const block = resp.content.find((c) => c.type === "text")
    raw = block && block.type === "text" ? block.text : ""
    usage = { input_tokens: resp.usage.input_tokens, output_tokens: resp.usage.output_tokens }
  } catch (e) {
    return {
      ok: false,
      reason: "claude_error",
      message: (e as Error).message,
      duration_ms: Date.now() - t0,
    }
  }

  // Parse JSON (코드블록 fence 자동 제거)
  const jsonText = stripCodeFence(raw)
  let parsed: PaperExtraction
  try {
    parsed = JSON.parse(jsonText) as PaperExtraction
  } catch (e) {
    return {
      ok: false,
      reason: "parse_failed",
      message: `JSON 파싱 실패: ${(e as Error).message}`,
      duration_ms: Date.now() - t0,
      raw_response_text: raw,
    }
  }

  // 비용 추정 (sonnet-4-5 standard rate, vision 없음)
  const inputCost = (usage.input_tokens ?? 0) * 0.000003
  const outputCost = (usage.output_tokens ?? 0) * 0.000015
  const cost = Number((inputCost + outputCost).toFixed(6))

  return {
    ok: true,
    extraction: parsed,
    model: VLM_MODEL,
    prompt_version: PROMPT_VERSION,
    duration_ms: Date.now() - t0,
    cost_usd: cost,
    raw_response_text: raw,
  }
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim()
  if (trimmed.startsWith("```")) {
    return trimmed.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```$/, "").trim()
  }
  return trimmed
}

const SCHEMAS: Record<SheetKind, string> = {
  rooms: JSON.stringify({
    schema_version: 1,
    sheet_kind: "rooms",
    business_date: "YYYY-MM-DD",
    rooms: [
      {
        room_no: "1|2|3|...",
        confidence: 0.95,
        manager_name: "string|null",
        customer_name: "string|null",
        headcount: 0,
        liquor: [{ brand: "string", amount_won: 0, paid_to_store_won: 0, qty: 1 }],
        rt_count: 0,
        waiter_tip_won: 0,
        staff_entries: [
          {
            time: "HH:MM",
            hostess_name: "string",
            origin_store: "string",
            service_type: "퍼블릭|셔츠|하퍼|null",
            time_tier: "free|차3|반티|반차3|완티|unknown",
            qty_full: 0,
            has_half: false,
            raw_text: "string",
            confidence: 0.95,
            hostess_payout_won: 0,
            manager_payout_won: 0,
          },
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
    confidence_self_report: 0.95,
  }, null, 2),

  staff: JSON.stringify({
    schema_version: 1,
    sheet_kind: "staff",
    business_date: "YYYY-MM-DD",
    staff: [
      {
        hostess_name: "string",
        sessions: [
          {
            time: "HH:MM",
            store: "string",
            service_type: "퍼블릭|셔츠|하퍼|null",
            time_tier: "free|차3|반티|반차3|완티|unknown",
            status: "완료|진행중|unknown",
            raw_text: "string",
            confidence: 0.95,
          },
        ],
        daily_totals: [0, 0],
      },
    ],
    daily_summary: { owe: [], recv: [] },
    unknown_tokens: ["string"],
    confidence_self_report: 0.95,
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
