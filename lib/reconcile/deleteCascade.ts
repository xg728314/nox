/**
 * R-Paper-Retention (2026-05-01): 종이장부 사진 cascade 삭제 helper.
 *
 * 운영자 의도:
 *   "사진은 PII 가 들어있어 예민. 일정 기간 후 삭제. 학습 corpus 는
 *    hash 처리되어 있으니 보존 (학습 효과 유지)."
 *
 * 정책:
 *   ✗ 삭제: Storage 사진, paper_ledger_snapshots, extractions, edits, diffs
 *   ✓ 보존: learning_signals (PII auto-hash), store_paper_format
 *
 * 호출 경로:
 *   1. DELETE /api/reconcile/[id]                       — 운영자 즉시 삭제
 *   2. /api/cron/paper-ledger-expire                     — 자동 만료 (매일)
 *
 * 실패 정책:
 *   - Storage 삭제 실패 → DB 는 진행 (orphan 별도 cleanup)
 *   - DB 단계 실패 → 부분 삭제 상태로 남을 수 있음 (audit log 가 흔적).
 *     완전한 트랜잭션 보장은 RPC function 으로 별도 라운드.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { removePaperLedger } from "@/lib/storage/paperLedgerBucket"

export type CascadeDeleteResult = {
  snapshot_id: string
  storage_removed: boolean
  storage_error?: string
  diffs_deleted: number
  edits_deleted: number
  extractions_deleted: number
  snapshot_deleted: boolean
  preserved: {
    learning_signals: "preserved (PII auto-hashed)"
    store_paper_format: "preserved (learning dictionary)"
  }
  errors: string[]
}

/**
 * 단일 snapshot cascade 삭제.
 *
 * @param supabase service-role client
 * @param snapshot_id 삭제할 snapshot id
 * @param expected_store_uuid (옵션) 권한 검증 — 매장 일치 강제. mismatch 시 throw.
 */
export async function cascadeDeletePaperLedger(
  supabase: SupabaseClient,
  snapshot_id: string,
  expected_store_uuid?: string,
): Promise<CascadeDeleteResult> {
  const result: CascadeDeleteResult = {
    snapshot_id,
    storage_removed: false,
    diffs_deleted: 0,
    edits_deleted: 0,
    extractions_deleted: 0,
    snapshot_deleted: false,
    preserved: {
      learning_signals: "preserved (PII auto-hashed)",
      store_paper_format: "preserved (learning dictionary)",
    },
    errors: [],
  }

  // 1. snapshot row 가져옴 (storage_path + store_uuid 검증)
  const { data: snap } = await supabase
    .from("paper_ledger_snapshots")
    .select("id, store_uuid, storage_path")
    .eq("id", snapshot_id)
    .maybeSingle()

  if (!snap) {
    result.errors.push("snapshot not found")
    return result
  }
  const s = snap as { id: string; store_uuid: string; storage_path: string }

  if (expected_store_uuid && s.store_uuid !== expected_store_uuid) {
    throw new Error(`Snapshot ${snapshot_id} belongs to store ${s.store_uuid}, expected ${expected_store_uuid}`)
  }

  // 2. Storage 사진 파일 삭제
  if (s.storage_path) {
    const removed = await removePaperLedger(supabase, s.storage_path)
    result.storage_removed = removed.ok
    if (!removed.ok) result.storage_error = removed.reason
  }

  // 3. DB cascade — 의존성 순서대로
  //   diffs 가 extractions 의 id 를 참조하므로 diffs 부터.
  //   edits 도 base_extraction_id 참조 → extractions 보다 먼저.
  try {
    const { count: diffsCount } = await supabase
      .from("paper_ledger_diffs")
      .delete({ count: "exact" })
      .eq("snapshot_id", snapshot_id)
    result.diffs_deleted = diffsCount ?? 0
  } catch (e) {
    result.errors.push(`diffs: ${(e as Error).message}`)
  }

  try {
    const { count: editsCount } = await supabase
      .from("paper_ledger_edits")
      .delete({ count: "exact" })
      .eq("snapshot_id", snapshot_id)
    result.edits_deleted = editsCount ?? 0
  } catch (e) {
    result.errors.push(`edits: ${(e as Error).message}`)
  }

  try {
    const { count: extCount } = await supabase
      .from("paper_ledger_extractions")
      .delete({ count: "exact" })
      .eq("snapshot_id", snapshot_id)
    result.extractions_deleted = extCount ?? 0
  } catch (e) {
    result.errors.push(`extractions: ${(e as Error).message}`)
  }

  // 4. snapshot 자체 삭제
  try {
    const { error: snapErr } = await supabase
      .from("paper_ledger_snapshots")
      .delete()
      .eq("id", snapshot_id)
    if (snapErr) result.errors.push(`snapshot: ${snapErr.message}`)
    else result.snapshot_deleted = true
  } catch (e) {
    result.errors.push(`snapshot: ${(e as Error).message}`)
  }

  return result
}

/**
 * 만료된 (expires_at < now()) snapshot 일괄 cascade 삭제.
 * cron 에서 호출.
 *
 * batch 처리 — 한 번에 50개씩 처리해서 transaction lock 최소화.
 */
export async function cascadeExpiredPaperLedgers(
  supabase: SupabaseClient,
  opts: { batch_size?: number; max_batches?: number } = {},
): Promise<{
  total_deleted: number
  total_failed: number
  per_snapshot: CascadeDeleteResult[]
  cutoff: string
}> {
  const batchSize = opts.batch_size ?? 50
  const maxBatches = opts.max_batches ?? 20
  const cutoff = new Date().toISOString()

  let totalDeleted = 0
  let totalFailed = 0
  const perSnapshot: CascadeDeleteResult[] = []

  for (let i = 0; i < maxBatches; i++) {
    const { data, error } = await supabase
      .from("paper_ledger_snapshots")
      .select("id")
      .not("expires_at", "is", null)
      .lt("expires_at", cutoff)
      .limit(batchSize)

    if (error) {
      // eslint-disable-next-line no-console
      console.warn("[cascadeExpired] batch fetch failed:", error.message)
      break
    }
    const rows = (data ?? []) as Array<{ id: string }>
    if (rows.length === 0) break

    for (const r of rows) {
      const res = await cascadeDeletePaperLedger(supabase, r.id)
      perSnapshot.push(res)
      if (res.snapshot_deleted) totalDeleted++
      else totalFailed++
    }

    if (rows.length < batchSize) break // 마지막 batch
  }

  return { total_deleted: totalDeleted, total_failed: totalFailed, per_snapshot: perSnapshot, cutoff }
}
