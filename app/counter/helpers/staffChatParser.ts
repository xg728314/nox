/**
 * Staff chat parser (dictionary-driven, v2).
 *
 * PURE function. No React, no network, no side effects.
 *
 * Rewrite of the v1 token-map parser to a proper dictionary structure:
 *   DomainEntry { code, label, aliases[], type }
 *
 * Each domain entry carries an explicit set of aliases; the matcher is
 * longest-alias-first, so unambiguous words never get chopped by shorter
 * abbreviations (e.g. "퍼블릭" wins over "퍼").
 *
 * Collision policy (locked by spec):
 *   - "퍼"     → ALWAYS PUBLIC category. Never FIRST store.
 *   - FIRST    → requires "퍼스" or "퍼스트" explicitly.
 *   - AURA     → requires "아우" or "아우라" explicitly.
 *   - "아"     → not mapped to any domain; falls through to name text.
 *   - When two aliases tie on length, CATEGORY/TICKET beats STORE so
 *     short work-tokens (퍼, 하, 셔, 완, 반, 차) cannot be shadowed by
 *     short store abbreviations.
 *
 * Supported inputs:
 *   - Spaced:   "라 시은 은지 퍼 완"
 *   - Attached: "라시은은지퍼완"
 *   - Mixed:    "라시은 은지퍼 완"
 *   - Multi-line — each line parsed independently.
 *   - Partial: non-matching Korean segments become name(s).
 *
 * Output shape is unchanged from v1 — consumers read `entries[].name`
 * (required) and the optional attribute fields. `extra` kept as a
 * deprecated-but-present field for back-compat.
 */

// ── Domain dictionary ──────────────────────────────────────────────

type DomainType = "STORE" | "CATEGORY" | "TICKET"

type DomainEntry = {
  code: string
  label: string
  aliases: string[]
  type: DomainType
}

// Stores — 실제 목록/별칭은 `helpers/storeRegistry.ts` 에서 단일 관리.
// 파서는 registry 엔트리를 `DomainEntry` 모양으로 재포장하기만 한다.
// 매장 추가/별칭 변경은 registry 파일에서만 수행하면 파서 dict·picker UI
// 모두 동시에 반영된다.
//
// 별칭 정책 (locked 2026-04-18):
//   - "퍼"  → CATEGORY "퍼블릭" 전용 (STORE 불가)
//   - "아"  → 미매핑 (아지트·아우라는 2-char 이상 prefix 필수)
//   - "하"/"차"/"반"/"완"/"셔" → 카테고리/티켓 전용
//   - 이 규칙은 `FORBIDDEN_1CHAR_ALIASES` + registry 모듈 로드-타임
//     self-check 로 빌드 시 강제된다.
import { STORE_REGISTRY } from "./storeRegistry"
const STORES: DomainEntry[] = STORE_REGISTRY.map(s => ({
  code: s.code,
  label: s.label,
  aliases: [...s.aliases],
  type: "STORE",
}))

// Categories (3) — 실사 확장 (2026-07-07):
//   실 카톡에서 자주 등장하는 축약/자모/조합 alias 추가.
//   퍼블/퍼블릭/ㅍ, 하퍼/ㅎ, 셔츠/ㅅ (호환 자모 U+3130~U+318F).
const CATEGORIES: DomainEntry[] = [
  { code: "PUBLIC", label: "퍼블릭", aliases: ["퍼블릭", "퍼블", "퍼", "ㅍ"], type: "CATEGORY" },
  { code: "HARPER", label: "하퍼",   aliases: ["하퍼", "하", "ㅎ"],   type: "CATEGORY" },
  { code: "SHIRTS", label: "셔츠",   aliases: ["셔츠", "셔", "ㅅ"],   type: "CATEGORY" },
]

// Ticket types — 실사 확장 (2026-07-07):
//   완메/메이드/ㅁㅇㄷ = 완티 결과 (종료 표기).
//   반차2, 반차3 = 반차 + 숫자.
const TICKETS: DomainEntry[] = [
  { code: "COMPLETE",  label: "완티",  aliases: ["완티", "완메", "메이드", "ㅁㅇㄷ", "완"], type: "TICKET" },
  { code: "HALF",      label: "반티",  aliases: ["반티", "반메", "반"], type: "TICKET" },
  // R-halfcha3-aliases (2026-08-23): 실장 축약 "반3" · "ㅂ3" 추가
  { code: "HALF_CHA3", label: "반차3", aliases: ["반차3", "반차2", "반차", "반3", "ㅂ3"], type: "TICKET" },
  { code: "CHA3",      label: "차3",   aliases: ["차3", "차"], type: "TICKET" },
]

// State (2026-07-07 신규): 손님 상태/조건 태그. 종목/티켓과 별개 축.
//   `땁` = 아직 안본 인원 (신 방문).
//   `본` = 이미 봤던 인원 (재방문).
//   `안본` = 안본 인원 (땁 동의어).
type StateType = "UNSEEN" | "SEEN"
type StateEntry = { code: StateType; label: string; aliases: string[] }
const STATES: StateEntry[] = [
  { code: "UNSEEN", label: "안본",  aliases: ["땁", "안본"] },
  { code: "SEEN",   label: "본",    aliases: ["본"] },
]

// Event (2026-07-07 신규): 세션 시작/종료 신호. dispatch 실행 X, 상태 전이만.
//   ㅅㅌㅌ = 스타트, ㅅㅊ = 시간체크 (세션 시작 확인).
// R-checkout-event (2026-08-23): 채팅 종료 표기 신호 추가.
//   실 실장 흐름: "지연 팅" · "지연 나감" · "지연 종료" · "지연 끝" · "지연 아웃"
//   → 자동 checkout 로 처리 (참여자 leave). 파서는 이벤트 flag 만 세팅 · 서버에서 처리.
type EventType = "START" | "TIME_CHECK" | "CHECKOUT" | "CHOICE_REQUEST"
type EventEntry = { code: EventType; label: string; aliases: string[] }
const EVENTS: EventEntry[] = [
  { code: "START",       label: "스타트",    aliases: ["스타트", "ㅅㅌㅌ"] },
  { code: "TIME_CHECK",  label: "시간체크",  aliases: ["시간체크", "ㅅㅊ"] },
  // R-checkout-event (2026-08-23): 다양한 종료 표기
  { code: "CHECKOUT",    label: "종료",      aliases: ["종료", "나감", "나갔", "끝", "아웃", "팅"] },
  // R-choice-request (2026-08-23): 초이스 요청 표기 · 매장 대기 손님 있음 신호
  //   "3인 초이스", "5인 초이스", "4명 있어요" 등
  { code: "CHOICE_REQUEST", label: "초이스 요청", aliases: ["초이스", "초3", "초2", "초5"] },
]

// ── Flattened alias lookup table ───────────────────────────────────
//
// Priority sort:
//   1. Longer alias first (so "퍼블릭" beats "퍼", "반차" beats "반").
//   2. On equal length, CATEGORY/TICKET (work) before STORE — enforces
//      "short work tokens have higher priority than short store aliases".
//
type AliasEntry = { alias: string; entry: DomainEntry }

const ALIAS_TABLE: AliasEntry[] = (() => {
  const all: AliasEntry[] = []
  for (const e of [...CATEGORIES, ...TICKETS, ...STORES]) {
    for (const a of e.aliases) all.push({ alias: a, entry: e })
  }
  return all.sort((a, b) => {
    if (b.alias.length !== a.alias.length) return b.alias.length - a.alias.length
    const workA = a.entry.type !== "STORE"
    const workB = b.entry.type !== "STORE"
    if (workA !== workB) return workA ? -1 : 1
    return 0
  })
})()

// ── Korean helpers ─────────────────────────────────────────────────
const HANGUL_SYLLABLE = /[\uAC00-\uD7AF]/
function containsHangul(s: string): boolean { return HANGUL_SYLLABLE.test(s) }

/**
 * Split a gap (unmatched segment) into candidate names.
 * Heuristic: Korean names are typically 2–3 syllables. We chunk at 2
 * per name, absorbing a trailing 3-char residual into the last chunk
 * (so "김민서민지" → ["김민", "서민지"], never "김민서민지" → ["김민","서민","지"]).
 * Non-Korean residue is dropped entirely per "remaining Korean segment".
 */
function splitNameSegment(raw: string): string[] {
  const s = raw.trim()
  if (!s || !containsHangul(s)) return []
  // Drop any non-hangul characters in the segment.
  const clean = Array.from(s).filter((ch) => HANGUL_SYLLABLE.test(ch)).join("")
  if (!clean) return []
  if (clean.length <= 3) return [clean]
  const names: string[] = []
  let i = 0
  while (i < clean.length) {
    const remaining = clean.length - i
    if (remaining === 3) {
      names.push(clean.slice(i))
      i += 3
    } else if (remaining === 1) {
      // absorb orphan syllable into previous name
      if (names.length > 0) names[names.length - 1] += clean.slice(i)
      else names.push(clean.slice(i))
      i += 1
    } else {
      names.push(clean.slice(i, i + 2))
      i += 2
    }
  }
  return names
}

// ── Trailing-noise suffix set ──────────────────────────────────────
//
// Operator shorthand frequently appends a short filler syllable
// immediately after a work token (ticket/category/store), e.g.
// "완메", "반메", "반차메", "차메". These are NOT names and NOT
// dictionary tokens — they are ignorable trailing noise. We allow the
// tokenizer to silently consume them ONLY when they appear right after
// a positive dictionary match, so genuine name syllables elsewhere
// (e.g. an actual "메" that starts a name) are never swallowed.
//
// Conservative initial set per spec — extend only after operator
// validation. Do NOT treat "메" as a semantic token (no 메이드 revival).
const TRAILING_NOISE: ReadonlySet<string> = new Set<string>(["메"])

// R-domain-blacklist (2026-08-23): 실 실장이 자주 쓰는 도메인 용어 · 존칭.
//   auto-provisioning 이 이 단어를 hostess 이름으로 오등록 방지.
//   예: "1번방 김사장님 지연 셔 완메" → 김사장님 skip · 지연만 등록.
//        "초이스 20명 봤어 지연 셔 완메" → 초이스/봤어 skip · 지연만 등록.
//   완전 일치 (splitNameSegment 결과 기준) 또는 suffix 매치 (사장님/이사님 등).
const NAME_BLACKLIST_EXACT: ReadonlySet<string> = new Set<string>([
  "초이스", "초3", "초2",
  "손님", "손", "응대", "오디션",
  "봤어", "본", "봐요", "봅니다",
  "왔어", "왔음", "옴",
  "나감", "나갔", "종료", "끝", "아웃", "팅",
  "잠깐", "잠시", "대기",
  "총알", "특별", "픽업",
  // R-unit-noise (2026-08-23): 측정 단위 · 숫자 뒤 흔한 접미
  "명", "개", "등", "번", "층",
])
// 존칭 suffix 로 끝나면 이름 아님 (김사장님/박이사님/이대표님 등)
const HONORIFIC_SUFFIXES: readonly string[] = [
  "사장님", "이사님", "대표님", "실장님", "부장님", "과장님",
  "선생님", "손님", "형님", "누나",
]

// ── Attached-shorthand tokenizer ───────────────────────────────────
//
// Walks the input left-to-right. At each position, tries the longest
// known alias. Unmatched characters accumulate as a gap; when a match
// fires (or the input ends), the current gap is emitted.
//
// Trailing-noise handling (additive, tolerant):
//   - Immediately after a positive dictionary match, any character in
//     TRAILING_NOISE is skipped silently and recorded as a "noise"
//     token. The line-level loop aggregates those into a single concise
//     warning per line (optional, low-severity).
//   - If the same character appears in any other position (start of
//     token, or after a gap), it is treated as ordinary unmatched
//     content — current additive-tolerant behavior is preserved.
type TokenOut =
  | { kind: "match"; entry: DomainEntry; text: string }
  | { kind: "gap"; text: string }
  | { kind: "noise"; text: string }

/**
 * Single-char alias acceptance guard.
 *
 * Fixes the mid-name false-match bug where single-syllable dictionary
 * aliases (라/발/버/하/차/반 …) would match inside Korean hostess names
 * and either truncate the name or overwrite line-level fields. Multi-
 * character aliases are never gated here — their specificity makes them
 * safe.
 *
 * Rules:
 *   - STORE  : 1-char match allowed ONLY at pos=0 of the attached part.
 *              Mid-part single-char store alias is absorbed into the
 *              gap as part of a name syllable.
 *   - CAT / TICKET:
 *       • gapLen >= 2  → a plausible 2+-syllable name has already
 *                        accumulated; the alias is the end-marker →
 *                        accept.
 *       • gapLen == 1  → looks like a name-start (e.g. "하" of "하린");
 *                        reject, keep absorbing into gap.
 *       • gapLen == 0  → at part-start or right after a prior match.
 *                        Accept iff the next char is (end-of-part |
 *                        start-of-another-alias | trailing-noise).
 *                        This preserves "퍼완", "하 완", "완메", "차메"
 *                        while rejecting "하린", "차연" etc.
 */
function isHangulChar(ch: string): boolean {
  if (!ch) return false
  const code = ch.charCodeAt(0)
  return code >= 0xAC00 && code <= 0xD7AF
}

function countHangulInRange(s: string, from: number, to: number): number {
  let n = 0
  for (let i = from; i < to; i++) {
    const code = s.charCodeAt(i)
    if (code >= 0xAC00 && code <= 0xD7AF) n++
  }
  return n
}

function acceptSingleCharAlias(
  input: string,
  pos: number,
  a: AliasEntry,
  gapStart: number | null
): boolean {
  if (a.alias.length !== 1) return true
  if (a.entry.type === "STORE") {
    // Base case: single-char STORE alias at the very start of the part
    // is always valid (e.g. "라시은퍼완" → 라이브 + 시은 + 퍼블릭 + 완티).
    if (pos === 0) return true
    // Mid-part case: allow a store transition ONLY when a complete name
    // has already accumulated in the gap (≥2 Hangul syllables). This
    // unblocks fully-attached mixed-store inputs like
    //   "마시은버은지라미미황지연"
    // to yield 4 distinct store prefixes — each preceded by a 2-syllable
    // name cluster. Critically preserves the name-protection invariant:
    //   "유라"         → at pos=1 "라", gap="유"   (1 Hangul) → reject
    //   "발유라셔반"    → at pos=2 "라", gap="유"   (1 Hangul) → reject
    //   "마시은버은지"  → at pos=3 "버", gap="시은" (2 Hangul) → ALLOW
    const hangulInGap =
      gapStart !== null ? countHangulInRange(input, gapStart, pos) : 0
    return hangulInGap >= 2
  }
  // CATEGORY / TICKET — gate by Hangul syllables accumulated in gap.
  // Counting Hangul (not raw chars) lets non-Hangul separators like
  // "-", ",", "/" inside the gap NOT block legitimate trailing alias
  // matches such as "퍼-완" or "황은지하완!!!".
  const hangulInGap =
    gapStart !== null ? countHangulInRange(input, gapStart, pos) : 0
  if (hangulInGap >= 2) return true
  if (hangulInGap === 1) return false
  // hangulInGap === 0: either part-start, or gap so far holds only
  // non-Hangul chars (separators/junk). Accept iff the NEXT character
  // is not a Hangul name-syllable that would continue a name.
  const nextPos = pos + 1
  if (nextPos >= input.length) return true
  const next = input[nextPos]
  if (TRAILING_NOISE.has(next)) return true
  if (!isHangulChar(next)) return true  // punctuation / latin / digit → safe
  for (const nx of ALIAS_TABLE) {
    if (input.startsWith(nx.alias, nextPos)) return true
  }
  return false
}

function tokenizeAttached(input: string): TokenOut[] {
  const out: TokenOut[] = []
  let pos = 0
  let gapStart: number | null = null
  // True iff the immediately preceding emission was a dictionary match.
  // Resets on any gap char or explicit gap emission.
  let justMatched = false
  while (pos < input.length) {
    let matched: AliasEntry | null = null
    for (const a of ALIAS_TABLE) {
      if (!input.startsWith(a.alias, pos)) continue
      if (!acceptSingleCharAlias(input, pos, a, gapStart)) continue
      matched = a
      break
    }
    if (matched) {
      if (gapStart !== null) {
        out.push({ kind: "gap", text: input.slice(gapStart, pos) })
        gapStart = null
      }
      out.push({ kind: "match", entry: matched.entry, text: matched.alias })
      pos += matched.alias.length
      justMatched = true
      continue
    }
    // No dictionary match at this position.
    const ch = input[pos]
    if (justMatched && TRAILING_NOISE.has(ch)) {
      // Suffix-noise right after a match → consume silently (no gap).
      // Stays `justMatched = true` so consecutive noise chars (e.g. a
      // hypothetical "메메") are all absorbed rather than forming a gap.
      out.push({ kind: "noise", text: ch })
      pos += 1
      continue
    }
    // Ordinary unmatched char → accumulate into gap.
    if (gapStart === null) gapStart = pos
    pos += 1
    justMatched = false
  }
  if (gapStart !== null) {
    out.push({ kind: "gap", text: input.slice(gapStart) })
  }
  return out
}

// ── Public types + API (signature unchanged from v1) ───────────────

export type ParsedStaffEntry = {
  /** Parsed person name (Korean). */
  name: string
  /** Resolved store full name (e.g. "라이브") or null if not specified in line. */
  origin_store_name: string | null
  /** Resolved category (e.g. "퍼블릭") or null. Falls back to `defaultCategory`. */
  category: string | null
  /** Resolved ticket type (e.g. "완티") or null. */
  ticket_type: string | null
  /** Deprecated — always null in v2 (extras dictionary removed per new spec). */
  extra: string | null
  /**
   * R-room-prefix (2026-06-28): "1번방" / "3번룸" / "R1" prefix 가 라인 앞에 있으면
   * 숫자 추출. null 이면 해당 라인에서 방 지정 없음 (dispatch route 가 빈 방 선택).
   */
  room_no: string | null
  /**
   * R-multi-category (2026-07-07): 결합 종목 파싱. `퍼하퍼셔` / `퍼블/하퍼/셔` 처럼
   * 여러 종목이 한 라인에 언급될 때 전체 리스트. 첫 번째는 `category` 와 동일.
   * 단일 종목이면 [category].
   */
  categories?: string[]
  /**
   * R-state (2026-07-07): 손님 상태. `땁`/`안본` → 'UNSEEN', `본` → 'SEEN'.
   * null 이면 해당 라인에 상태 태그 없음.
   */
  state: "UNSEEN" | "SEEN" | null
  /**
   * R-event (2026-07-07): 세션 이벤트 신호. `ㅅㅌㅌ`/`스타트` → 'START',
   * `ㅅㅊ`/`시간체크` → 'TIME_CHECK'. null 이면 이벤트 없음.
   */
  event: "START" | "TIME_CHECK" | "CHECKOUT" | "CHOICE_REQUEST" | null
}

/**
 * R-line-meta (2026-07-07): 라인 레벨 메타. 각 entry 에 복사되지 않고
 * ParseResult 의 `lineMetas[]` 에 라인 인덱스 별로 저장.
 */
export type LineMeta = {
  line_index: number
  /** `3인1빵` 같은 인원/방 표기 파싱 결과. */
  guest_count: number | null
  room_count: number | null
  /** 팁방 / 장타 / 사이즈만 / 인사x 등 조건 태그. */
  tags: string[]
  /** 손님 특징 자유 텍스트 (예: '50대 사장님 생일'). */
  guest_note: string | null
}

export type ParseResult = {
  entries: ParsedStaffEntry[]
  warnings: string[]
  /** R-line-meta (2026-07-07): 라인별 메타. */
  lineMetas?: LineMeta[]
}

// R-guest-count (2026-07-07): 인원/방 표기 정규식.
//   `3인1빵`, `4인2ㅃ`, `8인1ㅃㄱ`, `5인 새방` 등.
//   Group 1: 인원 (guest_count), Group 2 (optional): 방 개수 (room_count).
const GUEST_ROOM_RE = /(\d+)\s*인\s*(\d+)?\s*[ㅃㅁㅂ빵방]?[ㄱ]?/g

// R-tag-detect (2026-07-07): 조건/특징 키워드.
const TAG_PATTERNS: Array<{ tag: string; patterns: string[] }> = [
  { tag: "안본", patterns: ["안본인원", "안본"] },
  { tag: "본인원", patterns: ["본인원"] },
  { tag: "사이즈만", patterns: ["사이즈만", "사이즈로만", "사이즈로"] },
  { tag: "인사x", patterns: ["인사x", "인사X", "인사 x", "인사 안"] },
  { tag: "장타", patterns: ["장타"] },
  { tag: "팁방", patterns: ["팁방"] },
  { tag: "꿀방", patterns: ["꿀방", "개꿀"] },
  { tag: "착한", patterns: ["착한"] },
  { tag: "새방", patterns: ["새방", "쌔방"] },
  { tag: "일행추가", patterns: ["일행추가", "일행 추가"] },
  { tag: "무한날개", patterns: ["무한날개", "무한 날개"] },
  { tag: "무한연장", patterns: ["무한연장", "무한 연장"] },
  { tag: "날개체인지", patterns: ["날개체인지"] },
  { tag: "연장", patterns: ["연장"] },
]

function extractLineMeta(rawLine: string): LineMeta {
  const guestRoom: { guest: number | null; room: number | null } = { guest: null, room: null }
  GUEST_ROOM_RE.lastIndex = 0
  const m = GUEST_ROOM_RE.exec(rawLine)
  if (m) {
    guestRoom.guest = Number.isFinite(parseInt(m[1] ?? "", 10)) ? parseInt(m[1], 10) : null
    if (m[2]) {
      guestRoom.room = Number.isFinite(parseInt(m[2], 10)) ? parseInt(m[2], 10) : null
    }
  }
  const tags: string[] = []
  for (const t of TAG_PATTERNS) {
    for (const p of t.patterns) {
      if (rawLine.includes(p) && !tags.includes(t.tag)) {
        tags.push(t.tag)
        break
      }
    }
  }
  return {
    line_index: 0,
    guest_count: guestRoom.guest,
    room_count: guestRoom.room,
    tags,
    guest_note: null,
  }
}

/**
 * Parse a staff-chat message.
 *
 * @param text             Multi-line input. Each line is parsed independently.
 *                         Within a line, tokens can be space-separated OR
 *                         attached.
 * @param defaultCategory  Category label applied when no category token
 *                         appears in a given line. Typically the current
 *                         room's dominant category (e.g. "퍼블릭").
 *
 * INVARIANT — ADDITIVE / TOLERANT PARSING (LOCKED):
 *   - Unknown/unrecognized tokens MUST NEVER invalidate, clear, or
 *     overwrite previously parsed fields within the same line.
 *   - `store`, `category`, `ticket_type` are only ever ASSIGNED on a
 *     positive dictionary match — never reset to null on gap/miss.
 *   - Gap tokens contribute ONLY to the name list, via splitNameSegment
 *     which drops non-Hangul silently. A fully-unknown token is a no-op
 *     for field parsing.
 *   - A per-part exception is isolated (try/catch): an unexpected throw
 *     inside tokenizeAttached or splitNameSegment MUST NOT discard the
 *     store/category/ticket parses accumulated earlier in the same line.
 *   - A line with no names is skipped with a warning — but that is a
 *     per-line emit decision, NOT a field invalidation.
 */
export function parseStaffChat(
  text: string,
  defaultCategory: string | null = null
): ParseResult {
  const warnings: string[] = []
  const entries: ParsedStaffEntry[] = []
  const lineMetas: LineMeta[] = []
  if (!text || typeof text !== "string") return { entries, warnings, lineMetas }

  const lines = text.split(/\r?\n/)
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    let rawLine = lines[lineIdx]
    // R-room-anywhere (2026-08-23): "1번방" / "3번룸" / "2호실" / "1T" / "1번" 등
    //   방번호 표기가 라인 어디에 있어도 인식.
    //   실 사용자 입력 예: "마 2번방 지연 수연 미연 셔 완메", "1T 지연 셔 완메".
    //
    //   매칭 unit words (우선순위 순):
    //     1) 명확: 번방 / 번룸 / 번호실 / 호실
    //     2) 짧은형: T (실장 캐주얼 표기 "1T")
    //     3) 단독 "번" — 접미 다른 글자 없을 때만 (예 "1번 지연" OK, "1번방" 위 (1)에서 이미 매치)
    //   "R1" 프리픽스는 라인 시작에서만 (기존 유지).
    //   추출된 room_no 는 이 라인 모든 entries 에 적용.
    let lineRoomNo: string | null = null
    // 1) 명확 unit
    let roomMatch = rawLine.match(/(\d+)\s*(?:번방|번룸|번호실|호실)/i)
    // 2) 짧은 T 표기 — "1T" (영어) · "1티" (한글 축약) · 단독 토큰
    if (!roomMatch) roomMatch = rawLine.match(/(?:^|\s)(\d+)T(?=\s|$)/i)
    if (!roomMatch) roomMatch = rawLine.match(/(?:^|\s)(\d+)티(?=\s|$)/)
    // 3) 단독 "번" — "1번" · 뒤에 방/룸/호실 안 붙었을 때 · 앞뒤 공백 확실
    if (!roomMatch) roomMatch = rawLine.match(/(?:^|\s)(\d+)번(?![방룸호가])(?=\s|$)/)
    // 4) R1 라인 시작 (호환)
    if (!roomMatch) roomMatch = rawLine.trim().match(/^R(\d+)\s*/i)
    if (roomMatch) {
      lineRoomNo = roomMatch[1]
      // 매치 부분만 제거 (라인 나머지는 원래 순서 유지)
      const idx = rawLine.indexOf(roomMatch[0])
      if (idx >= 0) {
        rawLine = rawLine.slice(0, idx) + rawLine.slice(idx + roomMatch[0].length)
      }
    }
    const parts = rawLine.trim().split(/\s+/).filter(Boolean)
    if (parts.length === 0) continue

    let store: string | null = null
    let category: string | null = defaultCategory
    let ticket_type: string | null = null
    // R-multi-category (2026-07-07): 라인 내 등장한 모든 카테고리 축적.
    const categoriesList: string[] = []
    // R-state / R-event (2026-07-07): 라인 별 상태/이벤트 신호.
    let lineState: "UNSEEN" | "SEEN" | null = null
    let lineEvent: "START" | "TIME_CHECK" | "CHECKOUT" | "CHOICE_REQUEST" | null = null

    // 사전 등장 여부 검사 — 정규식이 아니라 부분 문자열 검색으로 간단히.
    //   자모 단독은 완성 한글 이름 안에서 매치되지 않으므로 안전.
    for (const s of STATES) {
      for (const a of s.aliases) {
        if (rawLine.includes(a)) { lineState = s.code; break }
      }
      if (lineState) break
    }
    for (const e of EVENTS) {
      for (const a of e.aliases) {
        if (rawLine.includes(a)) { lineEvent = e.code; break }
      }
      if (lineEvent) break
    }
    // Per-name store attribution — each emitted name snapshots the
    // `store` value that was active at the moment the name was produced.
    //
    // R-name-group (2026-08-23): per-name category/ticket 도 snapshot.
    //   실사용자 흐름: "수영 화영 퍼 지연 셔 완메"
    //     → 수영/화영 = 퍼블릭, 지연 = 셔츠 (각 이름 뒤에 오는 종목이 그 이름들에 적용)
    //   그룹 규칙:
    //     - CATEGORY 토큰: 아직 category 없는 pending names 에게 적용, 이후 새 그룹
    //     - TICKET 토큰: category 확정된 · ticket 없는 pending names 에게 적용
    //     - NAME 토큰: pending 에 category:null 로 append (다음 CATEGORY 대기)
    //   결과적으로 category/ticket 은 (locked spec 의 last-wins 대신) 그룹별로 스냅샷됨.
    const pending: Array<{
      name: string;
      origin_store_name: string | null;
      category: string | null;
      ticket_type: string | null;
    }> = []
    // 아직 category 배정 안 된 pending 인덱스들 (waiting for CATEGORY token)
    const waitingCatIdx: number[] = []
    // Aggregated per-line ignored suffix-noise chars (dedup, order-preserving).
    const noiseSeen: string[] = []

    for (const part of parts) {
      // R-standalone-noise (2026-08-23): "메" · "메이드" 등 standalone 완티 shorthand
      //   가 part 로 홀로 등장하면 skip (name 오탈 방지).
      //   기존 tokenizer 는 justMatched=true 일 때만 noise 로 처리 · standalone part 는
      //   자체적으로 justMatched=false 로 시작해서 이름으로 오분류.
      //   예: "수영 화영 퍼 완메 수영 셔 반차3 메" → 마지막 "메" 가 이름으로 됐던 버그.
      if (TRAILING_NOISE.has(part)) {
        if (!noiseSeen.includes(part)) noiseSeen.push(part)
        continue
      }
      // R-greeting-noise (2026-08-23): 5글자 이상 한글 part 는 인사말 가능성 높음.
      //   예: "안녕하세요" (5자) · "잘부탁드려요" (6자). 실 hostess 이름 최대 4자
      //   기준. tokenizer 가 dictionary alias (하/셔/차 등) 만나면 split 하지만
      //   그 앞뒤 gap 이 인사말 파편일 수 있음 → part 전체 노이즈 처리.
      //   조건: 순수 한글 + 5+자 + line 에 이미 다른 유효 token 있거나 없거나 무관.
      if (part.length >= 5 && /^[가-힣]+$/.test(part)) {
        if (!noiseSeen.includes(part)) noiseSeen.push(part)
        continue
      }
      // Defense-in-depth: any unexpected failure in the tokenizer or
      // name splitter is swallowed to honor the additive-tolerant
      // invariant. A single bad part NEVER clears store/category/ticket
      // that were already parsed successfully earlier in the line.
      try {
        const toks = tokenizeAttached(part)
        for (const t of toks) {
          if (t.kind === "match") {
            if (t.entry.type === "STORE") {
              // Store-lock (defense-in-depth): once a store is set on a
              // line, a later SINGLE-char store alias cannot overwrite
              // it. Multi-char stores (e.g. explicit "라이브") are always
              // authoritative. This protects against any tokenizer edge
              // case that might slip a mid-name single-char alias past
              // acceptSingleCharAlias.
              //
              // EXCEPTION for mixed-store multi-entry input: when the
              // previous gap already produced at least one pending name,
              // we intentionally ALLOW the store to change (even for a
              // 1-char alias) so subsequent names attach to the new
              // store. This is the "마시은 버은지 라…" pattern — each
              // store prefix owns the names that follow it.
              if (store === null || t.text.length > 1 || pending.length > 0) {
                store = t.entry.label
              }
              // R-multi-group-store (2026-08-23): 이미 이전 그룹이 ticket 까지 완결됐는데
              //   새 STORE 나오면 = 새 그룹 시작. category/ticket 리셋해서 후속 이름들이
              //   post-ticket-noise 로 오분류되지 않게 함.
              //   예: "마 지수 퍼 완메 라 수영 셔 반티" → 라 등장 시 그룹 리셋 → 수영/셔/반티 새 그룹.
              //   기존 "마 지연 라 미미 셔 완메" 케이스는 ticket_type 안 나왔으므로 리셋 안 됨 · 정상.
              if (ticket_type !== null) {
                category = null
                ticket_type = null
                waitingCatIdx.length = 0
              }
            }
            else if (t.entry.type === "CATEGORY") {
              category = t.entry.label
              // R-multi-category (2026-07-07): 중복 없이 순서대로 축적.
              if (!categoriesList.includes(t.entry.label)) {
                categoriesList.push(t.entry.label)
              }
              // R-name-group (2026-08-23): 대기 중인 이름들 · 이 카테고리로 확정.
              for (const idx of waitingCatIdx) {
                pending[idx].category = t.entry.label
              }
              waitingCatIdx.length = 0
            }
            else if (t.entry.type === "TICKET") {
              ticket_type = t.entry.label
              // R-name-group (2026-08-23): category 있는 · ticket 없는 pending 에 적용.
              for (const p of pending) {
                if (p.category && !p.ticket_type) p.ticket_type = t.entry.label
              }
            }
          } else if (t.kind === "noise") {
            if (!noiseSeen.includes(t.text)) noiseSeen.push(t.text)
          } else {
            // R-post-ticket-noise (2026-08-23): 티켓 확정 후 미매치 토큰 = 노이즈
            //   ("잘부탁드려요" · "!!!!" 등 뒤 인사말 사고 방지).
            if (ticket_type !== null && waitingCatIdx.length === 0) {
              if (!noiseSeen.includes(t.text)) noiseSeen.push(t.text)
            } else {
              // R-long-token-noise (2026-08-23): 원본 5글자+ 이 splitNameSegment 로
              //   여러 조각 나뉘면 (예: "안녕하세요" → "안녕"/"세요") 인사말 가능성 높음.
              //   한국 여자 이름 대부분 2-4자 · 4자 이하 원본은 이름 후보 유지.
              //   ("홍길동 김철수" 같은 3자 이름 여러 개는 space 로 이미 분리돼서 각 part 3자).
              const originalText = t.text
              const segments = splitNameSegment(originalText)
              const isProbablyGreeting = originalText.length >= 5 && segments.length > 1
              // R-domain-blacklist (2026-08-23): 원본 gap 전체가 존칭 suffix 로 끝나면
              //   splitNameSegment 하지 말고 통째로 skip.
              //   예: "김사장님" (4자 · seg=["김사","장님"]) · "박이사님" 등.
              const originalEndsHonorific = HONORIFIC_SUFFIXES.some((suf) => originalText.endsWith(suf))
              const originalIsBlacklisted = NAME_BLACKLIST_EXACT.has(originalText)
              if (isProbablyGreeting || originalEndsHonorific || originalIsBlacklisted) {
                if (!noiseSeen.includes(originalText)) noiseSeen.push(originalText)
              } else {
                for (const name of segments) {
                  // 개별 조각도 blacklist 체크 (splitNameSegment 후)
                  if (NAME_BLACKLIST_EXACT.has(name)) {
                    if (!noiseSeen.includes(name)) noiseSeen.push(name)
                    continue
                  }
                  if (HONORIFIC_SUFFIXES.some((suf) => name.endsWith(suf))) {
                    if (!noiseSeen.includes(name)) noiseSeen.push(name)
                    continue
                  }
                  pending.push({ name, origin_store_name: store, category: null, ticket_type: null })
                  waitingCatIdx.push(pending.length - 1)
                }
              }
            }
          }
        }
      } catch {
        // Skip this part only — accumulated fields remain intact.
        warnings.push(`${lineIdx + 1}행: "${part}" 토큰을 건너뛰었습니다.`)
      }
    }

    // One concise warning per line if any trailing-noise was trimmed.
    if (noiseSeen.length > 0) {
      warnings.push(`${lineIdx + 1}행: 일부 접미어(${noiseSeen.join(", ")})는 무시되었습니다.`)
    }

    if (pending.length === 0) {
      warnings.push(`${lineIdx + 1}행: 이름이 없어 건너뜁니다.`)
      continue
    }

    // Emit: each entry keeps its own snapshotted origin_store_name;
    //   R-name-group (2026-08-23): category/ticket_type 도 per-entry 스냅샷 우선.
    //   fallback: line-level 최종값 (기존 spec 호환).
    // R-multi-category / R-state / R-event (2026-07-07): 라인 메타를 각 entry 에 복사.
    for (const p of pending) {
      entries.push({
        name: p.name,
        origin_store_name: p.origin_store_name,
        category: p.category ?? category,
        ticket_type: p.ticket_type ?? ticket_type,
        extra: null,
        room_no: lineRoomNo,
        categories: categoriesList.length > 0 ? [...categoriesList] : (category ? [category] : []),
        state: lineState,
        event: lineEvent,
      })
    }

    // 라인 메타 저장 (인원/방/태그).
    const meta = extractLineMeta(rawLine)
    meta.line_index = lineIdx
    lineMetas.push(meta)
  }

  return { entries, warnings, lineMetas }
}

// ── Exports for tests / introspection (optional, additive) ─────────
export const __DICT__ = Object.freeze({
  STORES,
  CATEGORIES,
  TICKETS,
})
