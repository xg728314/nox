/**
 * Pure helpers for cross_store_work_records → cross_store_settlement_items
 * aggregate.
 *
 * ⚠️ 2026-04-24 재작성:
 *   구 resolver 는 staff_work_logs 의 category / work_type /
 *   external_amount_hint 에 의존. 라이브에 그 테이블이 없으므로 제거.
 *   신규 resolver 는 `session_participants.price_amount` 를 단일 금액
 *   출처로 사용한다. 타 매장 정산 축은 CLAUDE.md "origin_store_uuid 기준"
 *   과 일치.
 *
 * 금액 결정 원칙:
 *   - 오직 session_participants.price_amount 합계만 사용.
 *   - 하드코딩 금액 금지. 퍼센트 금지.
 *   - 매칭되는 participant 가 없거나 합계가 0 이하면 skip.
 *
 * Policy invariants (테스트 대상):
 *   1) record 의 (session_id, hostess_membership_id, working_store_uuid,
 *      origin_store_uuid) 가 participants 에 정확히 매칭되는 행의
 *      price_amount 합계를 amount 로 한다.
 *   2) 매칭 0건 → { ok: false, reason: "participant_not_found" }
 *   3) 합계 ≤ 0 → { ok: false, reason: "amount_zero" }
 *   4) role !== 'hostess' 인 row 는 집계에서 제외 (손님/실장 포함 금지).
 *   5) deleted_at 필터는 호출측 쿼리에서 이미 적용 — pure 함수는 입력받은
 *      배열만 본다.
 */

export type WorkRecordForResolve = {
  session_id: string
  hostess_membership_id: string
  working_store_uuid: string
  origin_store_uuid: string
}

export type ParticipantForResolve = {
  session_id: string
  membership_id: string | null
  store_uuid: string
  origin_store_uuid: string | null
  price_amount: number | null
  role: string
}

export type ResolveResult =
  | { ok: true; amount: number }
  | { ok: false; reason: string }

/**
 * record ↔ participants 매칭 후 price_amount 합계를 amount 로 반환.
 *
 * 매칭 조건:
 *   participant.session_id          === record.session_id
 *   participant.membership_id       === record.hostess_membership_id
 *   participant.store_uuid          === record.working_store_uuid
 *   participant.origin_store_uuid   === record.origin_store_uuid
 *   participant.role                === 'hostess'
 */
export function resolveAmountFromParticipants(
  record: WorkRecordForResolve,
  participants: ParticipantForResolve[],
): ResolveResult {
  const matched = participants.filter(
    (p) =>
      p.session_id === record.session_id &&
      p.membership_id === record.hostess_membership_id &&
      p.store_uuid === record.working_store_uuid &&
      p.origin_store_uuid === record.origin_store_uuid &&
      p.role === "hostess",
  )
  if (matched.length === 0) {
    return { ok: false, reason: "participant_not_found" }
  }
  let sum = 0
  for (const p of matched) {
    const n = Number(p.price_amount)
    if (Number.isFinite(n) && n > 0) sum += n
  }
  if (!(sum > 0)) {
    return { ok: false, reason: "amount_zero" }
  }
  return { ok: true, amount: sum }
}

/**
 * hostesses 테이블 스냅샷에서 manager_membership_id 매핑을 꺼낸다.
 * cross_store_work_records 에 manager 컬럼이 없으므로, item insert 시
 * 소속 실장을 item.manager_membership_id 에 채워 넣기 위한 유틸.
 *
 * 입력:
 *   hostessRows: [{ membership_id, manager_membership_id }]
 *
 * 반환: Map<hostess_membership_id, manager_membership_id | null>
 */
export function buildManagerMap(
  hostessRows: Array<{ membership_id: string; manager_membership_id: string | null }>,
): Map<string, string | null> {
  const m = new Map<string, string | null>()
  for (const h of hostessRows) {
    m.set(h.membership_id, h.manager_membership_id ?? null)
  }
  return m
}

/**
 * 중복 방지 키 — `(cross_store_work_record_id)` 파셜 UNIQUE 기반.
 * 이미 생성된 item 에 대해 upsert 가 아닌 "신규만 insert" 로 처리하기 위해
 * 호출측이 existing id 세트를 만들 때 쓰는 헬퍼.
 */
export function splitNewVsExisting<T extends { record_id: string }>(
  candidates: T[],
  existingRecordIds: Set<string>,
): { toInsert: T[]; alreadyLinked: T[] } {
  const toInsert: T[] = []
  const alreadyLinked: T[] = []
  for (const c of candidates) {
    if (existingRecordIds.has(c.record_id)) alreadyLinked.push(c)
    else toInsert.push(c)
  }
  return { toInsert, alreadyLinked }
}
