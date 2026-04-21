/**
 * correctionGuard — server-side abuse / data-quality protection for
 * the BLE correction write path.
 *
 * Evaluates three signals on the existing `ble_presence_corrections`
 * table (no new tables this round) and returns one of three decisions:
 *
 *   - "allow"              → proceed with the insert normally
 *   - "allow_with_warning" → proceed, but surface a soft warning to the
 *                            operator so they know the pattern is
 *                            unusual (actor burst, flip-flop)
 *   - "block"              → reject the write with a structured error
 *                            so the client can show a human message
 *
 * The guard is pure query logic — it never mutates rows. Caller is
 * `/api/ble/corrections` (single consumer; do not duplicate).
 *
 * Identity model (mirrors route.ts):
 *   - target_membership_id → `ble_presence_corrections.membership_id`
 *   - actor_membership_id  → `ble_presence_corrections.corrected_by_membership_id`
 *   - scope filter         → `store_uuid = auth.store_uuid`
 *
 * Analytics compatibility: when the decision is "allow" or
 * "allow_with_warning" the insert proceeds unchanged and the KPI /
 * accuracy widgets keep receiving valid correction rows. Only blocked
 * writes are omitted — by design, because they are duplicates of an
 * existing correction from <30s ago and would skew accuracy.
 */

import type { SupabaseClient } from "@supabase/supabase-js"

export const SAME_TARGET_COOLDOWN_MS = 30 * 1000       // rule A
export const ACTOR_BURST_WINDOW_MS   = 60 * 1000       // rule B
export const ACTOR_BURST_THRESHOLD   = 10              // rule B
export const FLIP_FLOP_WINDOW_MS     = 3 * 60 * 1000   // rule C
export const FLIP_FLOP_LOOKBACK      = 4               // rule C — inspect last N rows

export type CorrectionGuardDecision =
  | { decision: "allow" }
  | { decision: "allow_with_warning"; warning: CorrectionGuardWarning }
  | { decision: "block"; code: CorrectionGuardBlockCode; message: string; retry_after_ms: number }

export type CorrectionGuardWarning = {
  code: "FREQUENT_CORRECTION" | "FLIP_FLOP_PATTERN"
  message: string
  /** Optional structured hint the UI can show alongside the message. */
  detail?: {
    recent_count?: number
    window_ms?: number
    toggles?: number
  }
}

export type CorrectionGuardBlockCode = "CORRECTION_RATE_LIMITED"

export type CorrectionGuardInput = {
  supabase: SupabaseClient
  store_uuid: string
  actor_membership_id: string
  target_membership_id: string
  /** Zone the operator is SUBMITTING right now. Used for flip-flop
   *  detection alongside the historic zones. */
  next_zone: string
  /** Timestamp of the guard evaluation; defaulted to now(). Exposed
   *  so tests can pin it without monkey-patching Date. */
  nowMs?: number
}

/**
 * Run all three rules in a single evaluation. The guard returns the
 * STRONGEST decision:
 *   block > allow_with_warning > allow
 *
 * Only one warning code is returned even if both burst and flip-flop
 * would apply — flip-flop is prioritized because it is a stronger
 * data-quality signal per target than actor volume.
 */
export async function evaluateCorrectionGuard(
  input: CorrectionGuardInput,
): Promise<CorrectionGuardDecision> {
  const nowMs = input.nowMs ?? Date.now()

  // ── Rule A: same-target cooldown (hard block) ──────────────────
  // Use the (store_uuid, membership_id, corrected_at DESC) index
  // already present on the table — a single-row lookup.
  const { data: lastSameTarget } = await input.supabase
    .from("ble_presence_corrections")
    .select("corrected_at, corrected_zone, corrected_room_uuid")
    .eq("store_uuid", input.store_uuid)
    .eq("membership_id", input.target_membership_id)
    .order("corrected_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (lastSameTarget) {
    const lastMs = Date.parse(lastSameTarget.corrected_at as string)
    if (Number.isFinite(lastMs)) {
      const elapsed = nowMs - lastMs
      if (elapsed < SAME_TARGET_COOLDOWN_MS) {
        const retry = SAME_TARGET_COOLDOWN_MS - elapsed
        return {
          decision: "block",
          code: "CORRECTION_RATE_LIMITED",
          message: "같은 대상은 잠시 후 다시 수정할 수 있습니다.",
          retry_after_ms: Math.max(1, retry),
        }
      }
    }
  }

  // ── Rule C: flip-flop pattern (soft warning) ───────────────────
  // Pull the last N corrections for this target and count zone toggles
  // within a short window. A→B→A or A→B→A→B (with any room variation
  // inside "room") is treated as toggling. We compare (zone,room_uuid)
  // as a tuple so a room→room move between different rooms still
  // counts as a real change, not a flip.
  type Hist = { corrected_at: string; corrected_zone: string; corrected_room_uuid: string | null }
  const { data: historyRaw } = await input.supabase
    .from("ble_presence_corrections")
    .select("corrected_at, corrected_zone, corrected_room_uuid")
    .eq("store_uuid", input.store_uuid)
    .eq("membership_id", input.target_membership_id)
    .order("corrected_at", { ascending: false })
    .limit(FLIP_FLOP_LOOKBACK)
  const history = (historyRaw ?? []) as Hist[]

  const flipToggles = countFlipFlopToggles(
    history,
    { corrected_zone: input.next_zone, corrected_room_uuid: null },
    nowMs,
  )

  // ── Rule B: actor burst (soft warning) ─────────────────────────
  // Count how many corrections this actor has emitted within the
  // burst window across the whole store. No dedicated index exists
  // on corrected_by_membership_id today — 60-second windows keep
  // the scan small, but see INDEX NOTES below.
  const burstSinceIso = new Date(nowMs - ACTOR_BURST_WINDOW_MS).toISOString()
  const { count: actorRecent } = await input.supabase
    .from("ble_presence_corrections")
    .select("id", { count: "exact", head: true })
    .eq("store_uuid", input.store_uuid)
    .eq("corrected_by_membership_id", input.actor_membership_id)
    .gte("corrected_at", burstSinceIso)

  // Priority: flip-flop warning wins over burst warning. Both are
  // soft; we do not stack them into a single response.
  if (flipToggles >= 2) {
    return {
      decision: "allow_with_warning",
      warning: {
        code: "FLIP_FLOP_PATTERN",
        message: "같은 대상의 위치가 반복적으로 바뀌고 있습니다. 확인 후 진행하세요.",
        detail: { toggles: flipToggles, window_ms: FLIP_FLOP_WINDOW_MS },
      },
    }
  }

  if ((actorRecent ?? 0) >= ACTOR_BURST_THRESHOLD) {
    return {
      decision: "allow_with_warning",
      warning: {
        code: "FREQUENT_CORRECTION",
        message: "짧은 시간 내 반복 수정입니다.",
        detail: { recent_count: actorRecent ?? 0, window_ms: ACTOR_BURST_WINDOW_MS },
      },
    }
  }

  return { decision: "allow" }
}

/**
 * Count the number of zone-tuple toggles in an ordered history plus
 * the incoming proposed correction. A "toggle" is a change-of-direction
 * along the zone-tuple sequence:
 *   A B A    → 2 changes (A→B, B→A) = 1 toggle
 *   A B A B  → 3 changes = 2 toggles
 * Only rows within FLIP_FLOP_WINDOW_MS of nowMs are considered.
 * Exported for unit testing.
 */
export function countFlipFlopToggles(
  historyDescending: Array<{ corrected_at: string; corrected_zone: string; corrected_room_uuid: string | null }>,
  incoming: { corrected_zone: string; corrected_room_uuid: string | null },
  nowMs: number,
): number {
  // Filter to the window; keep descending order, then reverse to
  // chronological.
  const windowed = historyDescending
    .filter(h => {
      const t = Date.parse(h.corrected_at)
      return Number.isFinite(t) && (nowMs - t) <= FLIP_FLOP_WINDOW_MS
    })
    .slice()
    .reverse()

  const chain: Array<{ zone: string; room: string | null }> = [
    ...windowed.map(h => ({ zone: h.corrected_zone, room: h.corrected_room_uuid })),
    { zone: incoming.corrected_zone, room: incoming.corrected_room_uuid },
  ]

  // Collapse identical consecutive entries — a re-submit to the SAME
  // tuple isn't a flip, it's a duplicate (already blocked by cooldown).
  const collapsed: typeof chain = []
  for (const e of chain) {
    const prev = collapsed[collapsed.length - 1]
    if (!prev || prev.zone !== e.zone || prev.room !== e.room) collapsed.push(e)
  }

  // A toggle is a reversal: e[i-2] === e[i]. Count them.
  let toggles = 0
  for (let i = 2; i < collapsed.length; i++) {
    const a = collapsed[i - 2], c = collapsed[i]
    if (a.zone === c.zone && a.room === c.room) toggles++
  }
  return toggles
}
