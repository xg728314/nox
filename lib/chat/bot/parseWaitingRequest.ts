/**
 * lib/chat/bot/parseWaitingRequest.ts
 *
 * R37 (2026-09-09): 「대기 요청」 파싱 — 카톡 실사용 80% 를 차지하는 event.
 *
 * 카톡 실사용 샘플:
 *   [살아 두민형님] 퍼 4인 1빵 안본인원 대기부탁드려요
 *   [찬기] 하퍼 땁 새방 · 셔츠 3인 1빵 대기부탁드립니다
 *   [승] 셔 4인1ㅃ 안본인원 초이스있어요
 *   [슬] 퍼 하퍼 2인 새방 대기부탁드립니다 (퍼블릭 우대)
 *   [홀릭 락현] 셔 2인1ㅃ 본인원 ㄴ상관
 *   [경연 버닝] 하퍼 신규 4인 · 셔 신규 4인
 *   [창훈] 초이스 스톱   ← waitlist cancel event
 *
 * 반환: { kind: 'waiting_request', ... } 또는 { kind: 'waiting_cancel' }
 *       매칭 실패 시 null.
 *
 * 이 파서는 hostess 이름이 없는 메시지만 처리 (있으면 기존 파서로).
 */

export type WaitingRequestParsed = {
  kind: "waiting_request"
  category: "퍼블릭" | "하퍼" | "셔츠" | "any"
  party_size: number
  room_count: number
  is_new_room: boolean
  seen_policy: "unseen_only" | "any"
  is_choice: boolean            // 「초이스있어요」 여부
  tags: string[]                // ['안본인원', '본인원', '장타', '매너', ...]
  raw_text: string
}

export type WaitingCancelParsed = {
  kind: "waiting_cancel"
  raw_text: string
}

const WAITING_REQUEST_KEYWORDS = [
  "대기부탁", "대기 부탁", "대기점", "대기점여", "대기점요",
  "초이스있어", "초이스있습니다", "초이스 있어", "초이스 있습니다", "초이스잇",
  "초이스있", "체이스있",
]
const WAITING_CANCEL_KEYWORDS = [
  "초이스 스톱", "초이스스톱", "대기 취소", "대기취소",
]

// 종목 축약어 → 정식
const CATEGORY_ALIASES: Array<[RegExp, WaitingRequestParsed["category"]]> = [
  [/\b퍼블릭\b/, "퍼블릭"],
  [/\b퍼블\b/, "퍼블릭"],
  [/(^|\s|\p{P})퍼(?![\p{L}])/u, "퍼블릭"],
  [/\b하퍼\b/, "하퍼"],
  [/(^|\s|\p{P})하(?![\p{L}])/u, "하퍼"],
  [/\b셔츠\b/, "셔츠"],
  [/(^|\s|\p{P})셔(?![\p{L}])/u, "셔츠"],
]

const NEW_ROOM_KEYWORDS = ["새방", "신규", "새 방", "새룸"]
const CHANGE_ROOM_KEYWORDS = ["체인지", "체인지방", "타방", "장타방", "매너장타방"]
const UNSEEN_KEYWORDS = ["안본인원", "안 본 인원", "안 본인원"]
const SEEN_KEYWORDS = ["본인원", "본 인원"]

/**
 * parseWaitingMessage — 대기 요청 or 취소 감지.
 *   - hostess 이름 등장하면 null 반환 (기존 파서가 처리)
 *   - 여러 종목 (퍼 하퍼 셔츠) 언급 시 첫 종목 사용 · category='any' 로 대체
 */
export function parseWaitingMessage(text: string): WaitingRequestParsed | WaitingCancelParsed | null {
  // R37-fix (2026-09-09): normalize 가 「부탁드립니다·부탁드려요」 등을 제거 →
  //   대기 keyword 감지 실패했음. 감지는 원문에서, 파싱은 normalize 결과에서.
  if (!text || !text.trim()) return null
  const rawLower = text
  const normalized = normalize(text)

  // 취소 감지 (원문 기준)
  if (WAITING_CANCEL_KEYWORDS.some(k => rawLower.includes(k))) {
    return { kind: "waiting_cancel", raw_text: text }
  }

  // 대기 keyword 감지 (원문 기준 · normalize 전)
  const hasWaitingKw = WAITING_REQUEST_KEYWORDS.some(k => rawLower.includes(k))
  if (!hasWaitingKw) return null
  const t = normalized

  // 종목 감지 (여러 개 · any 처리)
  const foundCategories = new Set<WaitingRequestParsed["category"]>()
  for (const [re, cat] of CATEGORY_ALIASES) {
    if (re.test(t)) foundCategories.add(cat)
  }
  const category: WaitingRequestParsed["category"] =
    foundCategories.size === 1 ? [...foundCategories][0] :
    foundCategories.size > 1 ? "any" :
    "any"

  // 인원 · 방 수 감지 (「4인 1빵」 · 「2인 새방」 · 「4인1ㅃ」)
  //   ㅃ · 빵 = 방
  const partyMatch = t.match(/(\d+)\s*인/)
  const partySize = partyMatch ? Math.min(30, Math.max(1, parseInt(partyMatch[1], 10))) : 2
  const roomMatch = t.match(/(\d+)\s*[빵ㅃ]/)
  const roomCount = roomMatch ? Math.min(10, Math.max(1, parseInt(roomMatch[1], 10))) : 1

  // 방 유형
  // R37-fix (2026-09-09): 이전 로직 `!isChangeRoom && (NEW || !isChangeRoom)` 이 항상 !isChangeRoom
  //   → 아무 언급 없어도 「새방」으로 오해. 이제 명시 keyword 있을 때만 true.
  const isChangeRoom = CHANGE_ROOM_KEYWORDS.some(k => t.includes(k))
  const hasNewKeyword = NEW_ROOM_KEYWORDS.some(k => t.includes(k))
  const isNewRoom = !isChangeRoom && hasNewKeyword

  // 손님 안내
  const seenPolicy: WaitingRequestParsed["seen_policy"] =
    UNSEEN_KEYWORDS.some(k => t.includes(k)) ? "unseen_only" :
    SEEN_KEYWORDS.some(k => t.includes(k)) ? "any" :
    "any"

  // 초이스 여부
  const isChoice = /초이스\s*(있|잇)/.test(t)

  // tag 추출
  const tags: string[] = []
  if (UNSEEN_KEYWORDS.some(k => t.includes(k))) tags.push("안본인원")
  else if (SEEN_KEYWORDS.some(k => t.includes(k))) tags.push("본인원")
  if (t.includes("장타") || t.includes("매너장타")) tags.push("장타")
  if (t.includes("매너")) tags.push("매너")
  if (t.includes("우대")) tags.push("우대")
  if (t.includes("안섞")) tags.push("분리")

  return {
    kind: "waiting_request",
    category,
    party_size: partySize,
    room_count: roomCount,
    is_new_room: isNewRoom,
    seen_policy: seenPolicy,
    is_choice: isChoice,
    tags,
    raw_text: text,
  }
}

/** 정규화 · 이모지 제거 · 다중 공백 압축 · 인사말 접미 제거 */
function normalize(text: string): string {
  return text
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, " ") // 이모지
    .replace(/감사합니다|감사요|부탁드립니다|부탁드려요|드립니다|드려요|입니다|주세요|주여|점여|해주세요|드립/g, " ")
    .replace(/[~〜]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}
