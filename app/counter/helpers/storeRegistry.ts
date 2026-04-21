/**
 * STORE REGISTRY — 단일 원본 (locked 2026-04-18).
 *
 * 본 파일은 14개 매장의 이름/층/별칭 집합에 대한 **단일 소스 오브 트루스**다.
 * 아래 3개 경로는 반드시 이 registry를 파생해서 사용한다:
 *
 *   1. app/counter/types.ts             — ParticipantSetupSheetV2 store picker (STORES)
 *   2. app/counter/helpers/staffChatParser.ts — staff chat 파서 dict (STORES)
 *   3. (선택) inline editor store picker 등 어느 곳이든 store 리스트 필요 시
 *
 * 수정 원칙
 *   - 이 파일 하나만 건드린다. 다른 곳에 매장 리스트 하드코딩 금지.
 *   - alias 추가/변경 시 FORBIDDEN_1CHAR_ALIASES 충돌 검증 필수.
 *   - settlement 계산 규칙, parser 동작 범위, owner visibility 모두
 *     이 registry 변경과 무관하다.
 *
 * 6·7·8층 확장 전제
 *   - DB의 `stores.store_name`은 반드시 이 registry의 label과 정확히 일치해야 한다
 *     (exact match resolver가 app/api/store/staff/route.ts 에 있음).
 *   - DB의 `stores.floor`는 registry의 floor 숫자와 일치하는 것이 바람직하다
 *     (super-admin 대시보드 층 그룹핑에 사용).
 */

export type StoreCode =
  | "MARVEL" | "LIVE" | "BURNING" | "HWANGJINI"
  | "SHINSEGAE" | "AZIT" | "AURA" | "FIRST"
  | "SANGHANGA" | "TOKKI" | "BALI" | "DUBAI"
  | "BLACK" | "SSUM" | "PARTY"

export type StoreRegistryEntry = {
  code: StoreCode
  /** 매장 이름 — DB의 `stores.store_name`과 정확히 일치해야 한다. */
  label: string
  /** 5·6·7·8. picker 및 super-admin 대시보드 그룹핑 용도. */
  floor: 5 | 6 | 7 | 8
  /** 파서 + resolver 양쪽 모두에서 참조되는 매칭 토큰 집합. */
  aliases: readonly string[]
}

/**
 * 1-char alias가 다른 의미(카테고리/티켓/미매핑 정책)와 충돌해서
 * 절대로 STORE alias가 될 수 없는 글자 집합.
 *   - 아 : 아지트/아우라가 존재하므로 2-char 이상 prefix 필수 (미매핑 정책)
 *   - 퍼 : 카테고리 "퍼블릭" 전용
 *   - 하 : 카테고리 "하퍼" 전용
 *   - 차 : 티켓 "차3" 전용
 *   - 반 : 티켓 "반티" 전용
 *   - 완 : 티켓 "완티" 전용
 *   - 셔 : 카테고리 "셔츠" 전용
 *
 * 새 매장 추가 시 이 집합과 교차하는 1-char alias는 금지.
 */
export const FORBIDDEN_1CHAR_ALIASES: readonly string[] = [
  "아", "퍼", "하", "차", "반", "완", "셔",
]

/**
 * 고정 14-매장 registry.
 * alias 리스트는 user-spec (2026-04-18)을 그대로 반영한다.
 */
export const STORE_REGISTRY: readonly StoreRegistryEntry[] = [
  // ── 5층 ───────────────────────────────────────────────
  { code: "MARVEL",    label: "마블",   floor: 5, aliases: ["마", "마블"] },
  { code: "LIVE",      label: "라이브", floor: 5, aliases: ["라", "라이브"] },
  { code: "BURNING",   label: "버닝",   floor: 5, aliases: ["버", "버닝"] },
  { code: "HWANGJINI", label: "황진이", floor: 5, aliases: ["황", "황진"] },
  // ── 6층 ───────────────────────────────────────────────
  { code: "SHINSEGAE", label: "신세계", floor: 6, aliases: ["신", "신세"] },
  { code: "AZIT",      label: "아지트", floor: 6, aliases: ["아지", "아지트"] },
  { code: "AURA",      label: "아우라", floor: 6, aliases: ["아우", "아우라"] },
  { code: "FIRST",     label: "퍼스트", floor: 6, aliases: ["퍼스", "퍼스트"] },
  // ── 7층 ───────────────────────────────────────────────
  { code: "SANGHANGA", label: "상한가", floor: 7, aliases: ["상", "상한"] },
  { code: "TOKKI",     label: "토끼",   floor: 7, aliases: ["토", "토끼"] },
  { code: "BALI",      label: "발리",   floor: 7, aliases: ["발", "발리"] },
  { code: "DUBAI",     label: "두바이", floor: 7, aliases: ["두", "두바이"] },
  // ── 8층 ───────────────────────────────────────────────
  { code: "BLACK",     label: "블랙",   floor: 8, aliases: ["블", "블랙"] },
  { code: "SSUM",      label: "썸",     floor: 8, aliases: ["썸"] },
  { code: "PARTY",     label: "파티",   floor: 8, aliases: ["파", "파티"] },
] as const

// ── Derived convenience views ──────────────────────────────────────

/** picker UI 용 — `{ name, floor: "N층" }` */
export const STORE_PICKER_LIST: ReadonlyArray<{ name: string; floor: string }> =
  STORE_REGISTRY.map(s => ({ name: s.label, floor: `${s.floor}층` }))

/** `label → StoreRegistryEntry` 조회 맵. */
export const STORE_BY_LABEL: ReadonlyMap<string, StoreRegistryEntry> = new Map(
  STORE_REGISTRY.map(s => [s.label, s])
)

/** `alias → StoreCode` 조회 맵 (충돌 시 뒤값이 앞값을 덮음 — 아래 self-check로 방지). */
export const STORE_ALIAS_TO_CODE: ReadonlyMap<string, StoreCode> = (() => {
  const m = new Map<string, StoreCode>()
  for (const s of STORE_REGISTRY) {
    for (const a of s.aliases) m.set(a, s.code)
  }
  return m
})()

// ── Registry self-check — import 시점에 1회 검증 ──────────────────
//
// 다음 무결성을 모듈 로드 시 보장한다. 실패 시 즉시 throw 해서 배포된
// 번들이 잘못된 registry를 실어가지 못하게 한다.
//   (a) alias가 FORBIDDEN_1CHAR_ALIASES에 포함되지 않는다
//   (b) alias가 두 매장에서 중복되지 않는다
//   (c) 빈 alias / 공백 alias 없음
;(function assertStoreRegistryIntegrity() {
  const seen = new Map<string, StoreCode>()
  const forbidden = new Set(FORBIDDEN_1CHAR_ALIASES)
  for (const s of STORE_REGISTRY) {
    for (const a of s.aliases) {
      if (typeof a !== "string" || a.length === 0 || a.trim().length !== a.length) {
        throw new Error(`[storeRegistry] invalid alias for ${s.code}: ${JSON.stringify(a)}`)
      }
      if (a.length === 1 && forbidden.has(a)) {
        throw new Error(
          `[storeRegistry] alias "${a}" for ${s.code} is in FORBIDDEN_1CHAR_ALIASES ` +
          `(reserved for category/ticket/unmapped policy).`
        )
      }
      const prev = seen.get(a)
      if (prev && prev !== s.code) {
        throw new Error(
          `[storeRegistry] alias "${a}" claimed by both ${prev} and ${s.code}.`
        )
      }
      seen.set(a, s.code)
    }
  }
})()
