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

// Categories (3)
const CATEGORIES: DomainEntry[] = [
  { code: "PUBLIC", label: "퍼블릭", aliases: ["퍼", "퍼블릭"], type: "CATEGORY" },
  { code: "HARPER", label: "하퍼",   aliases: ["하", "하퍼"],   type: "CATEGORY" },
  { code: "SHIRTS", label: "셔츠",   aliases: ["셔", "셔츠"],   type: "CATEGORY" },
]

// Ticket types (4). "반차" must beat "반"; handled by length-desc sort.
const TICKETS: DomainEntry[] = [
  { code: "COMPLETE",  label: "완티",  aliases: ["완", "완티"],    type: "TICKET" },
  { code: "HALF",      label: "반티",  aliases: ["반", "반티"],    type: "TICKET" },
  { code: "HALF_CHA3", label: "반차3", aliases: ["반차", "반차3"], type: "TICKET" },
  { code: "CHA3",      label: "차3",   aliases: ["차", "차3"],     type: "TICKET" },
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
}

export type ParseResult = {
  entries: ParsedStaffEntry[]
  warnings: string[]
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
  if (!text || typeof text !== "string") return { entries, warnings }

  const lines = text.split(/\r?\n/)
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const rawLine = lines[lineIdx]
    const parts = rawLine.trim().split(/\s+/).filter(Boolean)
    if (parts.length === 0) continue

    let store: string | null = null
    let category: string | null = defaultCategory
    let ticket_type: string | null = null
    // Per-name store attribution — each emitted name snapshots the
    // `store` value that was active at the moment the name was produced.
    // This enables mixed-store single-line inputs like
    //   "마시은 버은지 라미미 황지연"
    // to yield 4 entries with 4 different origin_store_names instead of
    // collapsing to a single (last-parsed) store. Category / ticket_type
    // remain line-wide (last-wins, per locked spec) because real operator
    // usage rarely mixes those within one line.
    const pending: Array<{ name: string; origin_store_name: string | null }> = []
    // Aggregated per-line ignored suffix-noise chars (dedup, order-preserving).
    const noiseSeen: string[] = []

    for (const part of parts) {
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
            }
            else if (t.entry.type === "CATEGORY") category = t.entry.label
            else if (t.entry.type === "TICKET") ticket_type = t.entry.label
          } else if (t.kind === "noise") {
            if (!noiseSeen.includes(t.text)) noiseSeen.push(t.text)
          } else {
            for (const name of splitNameSegment(t.text)) {
              pending.push({ name, origin_store_name: store })
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

    // Emit: each entry keeps its own snapshotted origin_store_name; the
    // final category + ticket_type parsed on the line apply to all.
    for (const p of pending) {
      entries.push({
        name: p.name,
        origin_store_name: p.origin_store_name,
        category,
        ticket_type,
        extra: null,
      })
    }
  }

  return { entries, warnings }
}

// ── Exports for tests / introspection (optional, additive) ─────────
export const __DICT__ = Object.freeze({
  STORES,
  CATEGORIES,
  TICKETS,
})
