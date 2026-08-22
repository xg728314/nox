/**
 * Sprint 1 (2026-07-29): 파싱 결과 + 신뢰도 계산 + hostess/매장 resolve.
 *
 * 흐름:
 *   1. staffChatParser.parseStaffChat 호출 (기존 · 순수 함수)
 *   2. 각 entry 마다 DB lookup:
 *      - hostess (이름 exact · fuzzy · alias)
 *      - store (별칭 exact · alias)
 *   3. confidence 점수 계산 (0~100)
 *   4. 3-tier 판정: auto (95+) · quiet (70~94) · pending (40~69) · fail (<40)
 *
 * DB 접근은 read-only · INSERT 는 별도 route.
 */

import { parseStaffChat, type ParsedStaffEntry } from "@/app/counter/helpers/staffChatParser"
import type { SupabaseClient } from "@supabase/supabase-js"

export type ResolvedEntry = {
  raw: ParsedStaffEntry
  hostess_membership_id: string | null
  hostess_name_confirmed: string
  origin_store_uuid: string | null
  origin_store_name_confirmed: string | null
  category: string | null
  ticket_type: string | null
  room_no: string | null
  /** 개별 entry confidence · 0~100 */
  confidence: number
  /** 세부 breakdown (디버깅) */
  confidence_breakdown: Record<string, number>
  /** UI 힌트: 미등록 이름 → auto-provisioning 필요 */
  needs_provisioning: boolean
  /** UI 힌트: 파싱 실패 원인 */
  issues: string[]
}

export type ResolveResult = {
  entries: ResolvedEntry[]
  overall_confidence: number
  /** auto | quiet | pending | fail */
  tier: "auto" | "quiet" | "pending" | "fail"
  warnings: string[]
  raw_text: string
  parsed_at: string
}

export type ResolveContext = {
  supabase: SupabaseClient
  /** 발언자 실장 membership_id (있으면 알려진 발언자 +bonus) */
  actor_membership_id?: string | null
  /** 발언자 매장 store_uuid — 기본 매장 후보 */
  actor_store_uuid?: string | null
  /** 기본 category (파서 defaultCategory 로 전달) */
  default_category?: string | null
}

/** Levenshtein distance (2-row · space O(min(m,n))) */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  const m = a.length, n = b.length
  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  let curr = new Array<number>(n + 1)
  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1
      curr[j] = Math.min(
        curr[j - 1] + 1,        // insertion
        prev[j] + 1,             // deletion
        prev[j - 1] + cost,      // substitution
      )
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[n]
}

function similarity(a: string, b: string): number {
  const dist = levenshtein(a, b)
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 1
  return 1 - dist / maxLen
}

export async function parseChatWithConfidence(
  text: string,
  ctx: ResolveContext,
): Promise<ResolveResult> {
  const parsed = parseStaffChat(text, ctx.default_category ?? null)
  const nowIso = new Date().toISOString()

  if (parsed.entries.length === 0) {
    return {
      entries: [],
      overall_confidence: 0,
      tier: "fail",
      warnings: parsed.warnings,
      raw_text: text,
      parsed_at: nowIso,
    }
  }

  // 후보 hostess/store 이름 수집 (batch lookup)
  const names = Array.from(new Set(parsed.entries.map((e) => e.name).filter(Boolean)))
  const storeNames = Array.from(new Set(
    parsed.entries.map((e) => e.origin_store_name).filter((x): x is string => !!x),
  ))

  // 1) 매장 lookup (fuzzy · alias · exact 우선)
  const { data: storesData } = await ctx.supabase
    .from("stores")
    .select("id, store_name, floor")
    .is("deleted_at", null)
    .in("floor", [5, 6, 7, 8])
  const stores = (storesData ?? []) as Array<{ id: string; store_name: string; floor: number | null }>
  const storeByName = new Map(stores.map((s) => [s.store_name, s]))

  // 2) 발언자 매장 (있으면 이름 매칭 시 우선 후보)
  const preferredStoreUuids = new Set<string>()
  if (ctx.actor_store_uuid) preferredStoreUuids.add(ctx.actor_store_uuid)

  // 3) hostess lookup (매장별 · 이름 exact match 우선)
  //    매장 후보가 있으면 좁혀서 · 없으면 전체 (성능 위해 이름 in-list 로 필터)
  type HostessRow = { membership_id: string; store_uuid: string; profile_id: string; full_name: string }
  const hostessMap = new Map<string, HostessRow[]>() // name → candidates
  if (names.length > 0) {
    // 매장 5-8F hostess 전체 fetch (일회성 lookup · in-memory filter)
    const { data: memData } = await ctx.supabase
      .from("store_memberships")
      .select("id, store_uuid, profile_id")
      .eq("role", "hostess")
      .eq("status", "approved")
      .is("deleted_at", null)
      .in("store_uuid", stores.map((s) => s.id))
    const mems = (memData ?? []) as Array<{ id: string; store_uuid: string; profile_id: string }>
    if (mems.length > 0) {
      const profileIds = Array.from(new Set(mems.map((m) => m.profile_id)))
      const { data: profData } = await ctx.supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", profileIds)
      const nameByProfile = new Map((profData ?? []).map((p: { id: string; full_name: string | null }) => [p.id, p.full_name ?? ""]))
      for (const m of mems) {
        const fullName = nameByProfile.get(m.profile_id) ?? ""
        if (!fullName) continue
        const row: HostessRow = { membership_id: m.id, store_uuid: m.store_uuid, profile_id: m.profile_id, full_name: fullName }
        // Index: 이름 → 후보. 정확 이름 + 유사 이름 모두 인덱싱
        for (const parsedName of names) {
          const sim = similarity(parsedName, fullName)
          if (sim >= 0.7 || fullName.includes(parsedName) || parsedName.includes(fullName)) {
            const arr = hostessMap.get(parsedName) ?? []
            arr.push(row)
            hostessMap.set(parsedName, arr)
          }
        }
      }
    }
  }

  // 4) alias_learnings lookup (scope: global → store → manager)
  //    tolerance: 42P01 undefined_table → 무시
  const aliasByText = new Map<string, { resolved_type: string; resolved_id: string | null; resolved_value: string; bonus: number }>()
  try {
    const scopeFilter = [
      `and(scope.eq.global)`,
      ctx.actor_store_uuid ? `and(scope.eq.store,scope_id.eq.${ctx.actor_store_uuid})` : null,
      ctx.actor_membership_id ? `and(scope.eq.manager,scope_id.eq.${ctx.actor_membership_id})` : null,
    ].filter(Boolean).join(",")
    const uniqueRawNames = Array.from(new Set([...names, ...storeNames]))
    if (uniqueRawNames.length > 0) {
      const { data: aliasData, error: aliasErr } = await ctx.supabase
        .from("alias_learnings")
        .select("scope, scope_id, from_text, resolved_type, resolved_id, resolved_value")
        .in("from_text", uniqueRawNames)
        .or(scopeFilter)
      if (!aliasErr && aliasData) {
        for (const a of aliasData as Array<{ scope: string; from_text: string; resolved_type: string; resolved_id: string | null; resolved_value: string }>) {
          // priority: manager > store > global (bonus 크기)
          const bonus = a.scope === "manager" ? 25 : a.scope === "store" ? 20 : 15
          const prev = aliasByText.get(a.from_text)
          if (!prev || bonus > prev.bonus) {
            aliasByText.set(a.from_text, {
              resolved_type: a.resolved_type,
              resolved_id: a.resolved_id,
              resolved_value: a.resolved_value,
              bonus,
            })
          }
        }
      }
    }
  } catch { /* migration 174 미apply → 학습 없이 진행 */ }

  // 5) 각 entry resolve + confidence 계산
  const resolvedEntries: ResolvedEntry[] = parsed.entries.map((entry) => {
    const breakdown: Record<string, number> = {}
    const issues: string[] = []

    // 매장 resolve
    let originStoreUuid: string | null = null
    let originStoreName: string | null = entry.origin_store_name
    if (entry.origin_store_name) {
      const exact = storeByName.get(entry.origin_store_name)
      if (exact) {
        originStoreUuid = exact.id
        breakdown.store_exact = 30
      } else {
        // fuzzy 매장 매칭
        let best: { id: string; name: string; sim: number } | null = null
        for (const s of stores) {
          const sim = similarity(entry.origin_store_name, s.store_name)
          if (sim >= 0.7 && (!best || sim > best.sim)) {
            best = { id: s.id, name: s.store_name, sim }
          }
        }
        if (best) {
          originStoreUuid = best.id
          originStoreName = best.name
          breakdown.store_fuzzy = Math.round(20 * best.sim)
        } else {
          issues.push(`매장명 "${entry.origin_store_name}" 매칭 실패`)
          breakdown.store_fail = -20
        }
      }
    } else {
      // 매장 미지정 → 발언자 매장 fallback (5 bonus · 확실도 낮음)
      if (ctx.actor_store_uuid) {
        originStoreUuid = ctx.actor_store_uuid
        const s = stores.find((x) => x.id === ctx.actor_store_uuid)
        originStoreName = s?.store_name ?? null
        breakdown.store_from_actor = 10
      } else {
        breakdown.store_missing = -15
        issues.push("매장 미지정")
      }
    }

    // hostess resolve
    let hostessId: string | null = null
    let hostessName = entry.name
    let needsProvisioning = false
    const candidates = hostessMap.get(entry.name) ?? []
    // 매장 필터 (매장 확정된 경우 우선)
    const filtered = originStoreUuid
      ? candidates.filter((c) => c.store_uuid === originStoreUuid)
      : candidates
    const targetPool = filtered.length > 0 ? filtered : candidates
    if (targetPool.length === 0) {
      // alias 학습 fallback
      const aliasHit = aliasByText.get(entry.name)
      if (aliasHit && aliasHit.resolved_type === "hostess" && aliasHit.resolved_id) {
        hostessId = aliasHit.resolved_id
        hostessName = aliasHit.resolved_value
        breakdown.name_alias = aliasHit.bonus
      } else {
        // 신규 or 오타 · auto-provisioning 필요
        needsProvisioning = true
        breakdown.name_new = 5
        issues.push(`아가씨 "${entry.name}" 미등록`)
      }
    } else if (targetPool.length === 1) {
      // 유일한 매칭 → exact/fuzzy 판정
      const hit = targetPool[0]
      const sim = similarity(entry.name, hit.full_name)
      hostessId = hit.membership_id
      hostessName = hit.full_name
      if (sim >= 0.99) breakdown.name_exact = 25
      else breakdown.name_fuzzy = Math.round(20 * sim)
    } else {
      // 다중 매칭 → 매장 미확정이면 애매
      if (originStoreUuid) {
        // 매장 확정 상태에서 여러 후보 = 동명이인
        breakdown.name_ambig_same_store = -10
        issues.push(`같은 매장 동명이인 ${targetPool.length}명`)
        hostessId = targetPool[0].membership_id
        hostessName = targetPool[0].full_name
      } else {
        breakdown.name_ambig = -20
        issues.push(`동명이인 ${targetPool.length}개 매장`)
      }
    }

    // 종목/티켓
    if (entry.category) breakdown.category = 15
    else { breakdown.category_missing = -10; issues.push("종목 미지정") }
    if (entry.ticket_type) breakdown.ticket = 15
    else breakdown.ticket_missing = -5

    // 방번호
    if (entry.room_no) breakdown.room_no = 5

    // 알려진 발언자
    if (ctx.actor_membership_id) breakdown.known_speaker = 10

    // 합산
    const rawSum = Object.values(breakdown).reduce((a, b) => a + b, 0)
    const confidence = Math.max(0, Math.min(100, rawSum))

    return {
      raw: entry,
      hostess_membership_id: hostessId,
      hostess_name_confirmed: hostessName,
      origin_store_uuid: originStoreUuid,
      origin_store_name_confirmed: originStoreName,
      category: entry.category,
      ticket_type: entry.ticket_type,
      room_no: entry.room_no,
      confidence,
      confidence_breakdown: breakdown,
      needs_provisioning: needsProvisioning,
      issues,
    }
  })

  // Overall confidence = 최소값 (가장 약한 entry 기준 · 보수적)
  const overall = resolvedEntries.length > 0
    ? Math.min(...resolvedEntries.map((e) => e.confidence))
    : 0

  const tier: ResolveResult["tier"] =
    overall >= 95 ? "auto"
    : overall >= 70 ? "quiet"
    : overall >= 40 ? "pending"
    : "fail"

  return {
    entries: resolvedEntries,
    overall_confidence: overall,
    tier,
    warnings: parsed.warnings,
    raw_text: text,
    parsed_at: nowIso,
  }
}
