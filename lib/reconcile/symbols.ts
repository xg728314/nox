/**
 * R27: 종이장부 심볼 사전. 매장별 차이 누적 학습용.
 *
 * 기본 사전 = 사용자가 알려준 NOX 표준 (마블 매장 기준):
 *   ★ → 셔츠
 *   빨간 동그라미 → 차3
 *   (완) → 완티 / (반) → 반티 / (반차3) / (빵3) → 반차3
 *   ㅡ ㅜ → 한자 一 / 二 (1타임 / 2타임)
 *   시간 뒤 S → 셔츠
 *   "이름·매장" → hostess_name + origin_store
 *
 * 매장별로 다를 수 있어서 store_paper_format.symbol_dictionary 에서
 *   override. 해당 매장에 없는 심볼은 default 적용.
 */

import type { ServiceType, TimeTier } from "./types"

export type SymbolMeaning = {
  service_type?: ServiceType
  time_tier?: TimeTier
  /** 사람이 한 번 더 봐야 한다는 신호. (잔) 처럼 의미 미확정. */
  needs_review?: boolean
  /** 자유 메모. */
  note?: string
}

/** 모든 매장 공통 기본 사전. */
export const DEFAULT_SYMBOL_DICTIONARY: Record<string, SymbolMeaning> = {
  // ─ 종목 표기
  "★": { service_type: "셔츠" },
  "S": { service_type: "셔츠" },          // 시간 뒤 영문 S
  // ─ 시간 등급
  "(완)": { time_tier: "완티" },
  "완": { time_tier: "완티" },
  "(반)": { time_tier: "반티" },
  "반": { time_tier: "반티" },
  "(반차3)": { time_tier: "반차3" },
  "(빵3)": { time_tier: "반차3" },         // "반차3" 의 흘려쓴 형태
  "빵3": { time_tier: "반차3" },
  // ─ 차3 — 빨간 동그라미는 시각적 심볼이라 텍스트 매핑 불가, VLM 이 직접 인식
  "(차3)": { time_tier: "차3" },
  "차3": { time_tier: "차3" },
  // ─ 알 수 없음 — 사람 확인 필요
  "(잔)": { needs_review: true, note: "의미 미확정 — 매장 사장 확인 필요" },
  "잔": { needs_review: true, note: "의미 미확정" },
}

/** 한자 一/二 매핑 — 룸티/타임 카운트. */
export const HANJA_DIGITS: Record<string, number> = {
  "一": 1,
  "ㅡ": 1,    // 흘려쓰면 한글 ㅡ 처럼 보임
  "二": 2,
  "ㅜ": 2,    // 흘려쓰면 한글 ㅜ
  "三": 3,
}

/** 매장 화이트리스트 — 사장이 시스템에 등록한 협력 매장. */
export const DEFAULT_KNOWN_STORES: readonly string[] = [
  "마블", "라이브", "버닝", "황진이",
  "토끼", "발리", "신세계", "아우라", "피티",
  "7층", "1층", "지미",
  "항경", "의찬",
] as const

/**
 * 사전 lookup — store-specific 가 default 를 override.
 *   대소문자/공백 정규화: 양쪽 trim, 양옆 괄호 통일.
 */
export function lookupSymbol(
  raw: string,
  storeDict?: Record<string, SymbolMeaning>,
): SymbolMeaning | null {
  const norm = raw.trim()
  if (storeDict && norm in storeDict) return storeDict[norm]
  if (norm in DEFAULT_SYMBOL_DICTIONARY) return DEFAULT_SYMBOL_DICTIONARY[norm]
  // 괄호 변형 — (XXX) 와 XXX 중 어느 쪽이든 매핑 시도
  const stripped = norm.replace(/^[(\[]|[)\]]$/g, "")
  if (storeDict && stripped in storeDict) return storeDict[stripped]
  if (stripped in DEFAULT_SYMBOL_DICTIONARY) return DEFAULT_SYMBOL_DICTIONARY[stripped]
  return null
}

/** 한자 카운트 추출 — "一", "ㅡ", "二", "ㅜ" → 숫자. */
export function parseHanjaCount(raw: string): number | null {
  const norm = raw.trim()
  if (norm in HANJA_DIGITS) return HANJA_DIGITS[norm]
  // "TT" 처럼 영문 반복 — T 두 번이면 二
  if (/^T+$/i.test(norm)) return norm.length
  return null
}

/**
 * 매장 이름 매칭 — 화이트리스트 안의 매장명에 가장 가까운 것 반환.
 *   퍼지 매칭은 안 함 (오답 위험). 정확 일치만.
 */
export function matchKnownStore(
  raw: string,
  knownStores: readonly string[] = DEFAULT_KNOWN_STORES,
): string | null {
  const norm = raw.trim()
  if (!norm) return null
  for (const s of knownStores) {
    if (s === norm) return s
  }
  return null
}
