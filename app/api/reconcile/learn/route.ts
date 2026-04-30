import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { logAuditEvent } from "@/lib/audit/logEvent"
import type {
  PaperExtraction, PaperRoomCell, RoomStaffEntry,
  PaperStaffRow, StaffSession,
} from "@/lib/reconcile/types"

/**
 * POST /api/reconcile/learn
 *
 * R-Learn: paper_ledger_edits 누적분에서 매장별 학습 패턴 추출 →
 *          store_paper_format.symbol_dictionary 에 자동 누적.
 *
 * 권한: owner only (학습은 매장 운영 정책의 일부).
 *
 * 학습 대상 (1차):
 *   - 자주 수정되는 hostess_name 패턴 (raw_text → 정정값 매핑이 N회 이상 반복)
 *     예: raw_text 안 "한별" 토큰 → hostess_name "한별" 로 자주 수정 → dictionary 추가
 *   - 자주 수정되는 origin_store 패턴
 *
 * 학습 안 하는 것 (1차):
 *   - 양주 brand (이미 default dictionary 가 잘 작동)
 *   - confidence 가 정확한 케이스 (수정 안 됨)
 *
 * 알고리즘:
 *   1. 최근 N일 (default 30) edits 가져옴
 *   2. 각 edit 의 base_extraction 과 비교
 *   3. (base.raw_text 의 토큰) → (edited 의 hostess_name) 매핑 카운트
 *   4. count >= MIN_OCCURRENCES (default 2) 만 dictionary 에 누적
 *
 * 결과: store_paper_format.symbol_dictionary 에 신규 entry 추가 (기존 보존, conflict 시 skip).
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const DEFAULT_DAYS = 30
const MIN_OCCURRENCES = 2
const MAX_NEW_ENTRIES = 50  // 한 번에 dictionary 폭주 방지

function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

/** raw_text 에서 한글 토큰 추출 (한글 1~5글자, 숫자/영어 제외) */
function extractHangulTokens(raw: string | null | undefined): string[] {
  if (!raw) return []
  const matches = raw.match(/[가-힣]{1,5}/g)
  return matches ?? []
}

type LearningPair = {
  raw: string
  field: "hostess_name" | "origin_store"
  value: string
}

/** staff sheet 의 (raw_token → corrected_value) 학습 쌍 추출.
 *
 * 2026-04-30 (R-staff-learn): 이전엔 rooms 만 학습했는데 staff 시트가
 * 가장 자주 편집되는 sheet 라 누락됐음. 11명 staff 편집해도 학습 0건이던
 * 결함 보정. hostess_name + store 두 필드 모두 학습.
 */
function collectStaffLearningPairs(
  baseStaff: PaperStaffRow[] | undefined,
  editedStaff: PaperStaffRow[] | undefined,
): LearningPair[] {
  if (!baseStaff || !editedStaff) return []
  const out: LearningPair[] = []
  const minLen = Math.min(baseStaff.length, editedStaff.length)
  for (let i = 0; i < minLen; i++) {
    const b = baseStaff[i]
    const e = editedStaff[i]

    // ① hostess_name 학습 — base.raw_text (각 session) 의 한글 토큰 → e.hostess_name
    if (e.hostess_name && e.hostess_name.length >= 2 && e.hostess_name !== b.hostess_name) {
      const baseSessions = (b.sessions ?? []) as StaffSession[]
      const sessionRawTokens = new Set<string>()
      for (const s of baseSessions) {
        for (const tok of extractHangulTokens(s.raw_text)) sessionRawTokens.add(tok)
      }
      // base.hostess_name 자체도 토큰으로 인정 (AI 가 일부만 잡았을 수 있음)
      for (const tok of extractHangulTokens(b.hostess_name)) sessionRawTokens.add(tok)

      for (const tok of sessionRawTokens) {
        if (tok.length < 2) continue
        if (tok === e.hostess_name || e.hostess_name.includes(tok) || tok.includes(e.hostess_name)) {
          out.push({ raw: tok, field: "hostess_name", value: e.hostess_name })
        }
      }
    }

    // ② store 학습 — session 별 비교 (raw_text 의 토큰 → e.session.store)
    const minSess = Math.min((b.sessions ?? []).length, (e.sessions ?? []).length)
    for (let j = 0; j < minSess; j++) {
      const bs = (b.sessions ?? [])[j]
      const es = (e.sessions ?? [])[j]
      if (!es?.store || es.store.length < 2) continue
      if (bs?.store === es.store) continue  // 변화 없음

      for (const tok of extractHangulTokens(bs?.raw_text)) {
        if (tok.length < 2) continue
        if (tok === es.store || es.store.includes(tok) || tok.includes(es.store)) {
          out.push({ raw: tok, field: "origin_store", value: es.store })
        }
      }
    }
  }
  return out
}

/** edit 한 번에서 학습 가능한 (raw_token → corrected_value) 쌍 추출 */
function collectLearningPairs(
  baseRooms: PaperRoomCell[] | undefined,
  editedRooms: PaperRoomCell[] | undefined,
): LearningPair[] {
  if (!baseRooms || !editedRooms) return []
  const out: LearningPair[] = []

  // room_no 매칭으로 base ↔ edited 비교 (방 추가/삭제 무관)
  const editedByRoom = new Map<string, PaperRoomCell>()
  for (const r of editedRooms) editedByRoom.set(r.room_no, r)

  for (const baseRoom of baseRooms) {
    const editedRoom = editedByRoom.get(baseRoom.room_no)
    if (!editedRoom) continue
    const baseStaff = baseRoom.staff_entries ?? []
    const editStaff = editedRoom.staff_entries ?? []

    // index 단위 비교 (가장 단순). 정확 매칭 어려우면 raw_text 매칭.
    const minLen = Math.min(baseStaff.length, editStaff.length)
    for (let i = 0; i < minLen; i++) {
      const b = baseStaff[i] as RoomStaffEntry
      const e = editStaff[i] as RoomStaffEntry

      // hostess_name 학습: 사용자가 b.hostess_name (또는 빈 칸) → e.hostess_name 으로 수정
      if (e.hostess_name && e.hostess_name.length > 0 && e.hostess_name !== b.hostess_name) {
        // raw_text 의 한글 토큰들을 e.hostess_name 으로 매핑
        for (const tok of extractHangulTokens(b.raw_text)) {
          // 토큰이 너무 일반적 (1글자) 면 skip — false positive 방지
          if (tok.length < 2) continue
          // 토큰이 대부분 corrected value 와 비슷한 경우만 (편집 거리 등은 생략, 단순 substring)
          if (tok === e.hostess_name || e.hostess_name.includes(tok) || tok.includes(e.hostess_name)) {
            out.push({ raw: tok, field: "hostess_name", value: e.hostess_name })
          }
        }
      }
      // origin_store 학습 (동일 패턴)
      if (e.origin_store && e.origin_store.length > 0 && e.origin_store !== b.origin_store) {
        for (const tok of extractHangulTokens(b.raw_text)) {
          if (tok.length < 2) continue
          if (tok === e.origin_store || e.origin_store.includes(tok) || tok.includes(e.origin_store)) {
            out.push({ raw: tok, field: "origin_store", value: e.origin_store })
          }
        }
      }
    }
  }
  return out
}

export async function POST(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN", message: "owner only" }, { status: 403 })
    }

    const body = (await request.json().catch(() => ({}))) as { days?: number; dry_run?: boolean }
    const days = Math.max(1, Math.min(365, Number(body.days) || DEFAULT_DAYS))
    const dryRun = body.dry_run === true

    const supabase = supa()
    const sinceIso = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString()

    // 1. 매장의 최근 edits + base extraction 가져옴
    const { data: edits, error: editErr } = await supabase
      .from("paper_ledger_edits")
      .select("id, snapshot_id, base_extraction_id, edited_json, edited_at")
      .gte("edited_at", sinceIso)
      .limit(500)
    if (editErr) {
      return NextResponse.json({ error: "DB_ERROR", message: editErr.message }, { status: 500 })
    }

    // edits 의 매장 스코프는 snapshot 통해서. 매장 필터링.
    const editIds = (edits ?? []).map((e: { id: string }) => e.id)
    const snapIds = Array.from(new Set((edits ?? []).map((e: { snapshot_id: string }) => e.snapshot_id)))
    const baseIds = Array.from(new Set((edits ?? [])
      .map((e: { base_extraction_id: string | null }) => e.base_extraction_id)
      .filter((b): b is string => b != null)))

    if (snapIds.length === 0) {
      return NextResponse.json({
        ok: true,
        days,
        edits_scanned: 0,
        new_entries: 0,
        skipped: "no edits in window",
      })
    }

    const [snapsRes, basesRes] = await Promise.all([
      supabase
        .from("paper_ledger_snapshots")
        .select("id, store_uuid")
        .in("id", snapIds),
      baseIds.length > 0
        ? supabase.from("paper_ledger_extractions").select("id, extracted_json").in("id", baseIds)
        : Promise.resolve({ data: [] as { id: string; extracted_json: PaperExtraction }[] }),
    ])
    const snapById = new Map<string, string>()
    for (const s of (snapsRes.data ?? []) as { id: string; store_uuid: string }[]) {
      snapById.set(s.id, s.store_uuid)
    }
    const baseById = new Map<string, PaperExtraction>()
    for (const b of (basesRes.data ?? []) as { id: string; extracted_json: PaperExtraction }[]) {
      baseById.set(b.id, b.extracted_json)
    }

    // 2. 매장 스코프 — auth.store_uuid 의 edit 만 학습
    const ownStoreEdits = (edits ?? []).filter(
      (e: { snapshot_id: string }) => snapById.get(e.snapshot_id) === auth.store_uuid,
    )

    // 3. 학습 pair 수집 + count.
    //    rooms + staff 양쪽 다 학습. 매장명 (origin_store / store) 도
    //    별도로 known_stores set 에 누적해 다음 추출 prompt 에 주입.
    const counter = new Map<string, { count: number; field: string; value: string; raw: string }>()
    const learnedStoreNames = new Set<string>()  // known_stores 후보
    const learnedHostessNames = new Set<string>()
    let scanned = 0
    for (const e of ownStoreEdits) {
      const ee = e as { id: string; base_extraction_id: string | null; edited_json: PaperExtraction }
      const baseJson = ee.base_extraction_id ? baseById.get(ee.base_extraction_id) ?? null : null
      if (!baseJson) continue
      scanned++
      // rooms sheet 학습
      const roomPairs = collectLearningPairs(baseJson.rooms, ee.edited_json.rooms)
      // staff sheet 학습 (2026-04-30 추가)
      const staffPairs = collectStaffLearningPairs(baseJson.staff, ee.edited_json.staff)
      for (const p of [...roomPairs, ...staffPairs]) {
        const key = `${p.field}:${p.raw}→${p.value}`
        const cur = counter.get(key)
        if (cur) cur.count++
        else counter.set(key, { count: 1, field: p.field, value: p.value, raw: p.raw })
        if (p.field === "origin_store" && p.value.length >= 2) learnedStoreNames.add(p.value)
        if (p.field === "hostess_name" && p.value.length >= 2) learnedHostessNames.add(p.value)
      }
      // 추가: edit 의 모든 staff row 에서 store 가 명시된 것 → known_stores 후보 (편집된 store 는 운영자가 검증한 것).
      for (const row of (ee.edited_json.staff ?? []) as PaperStaffRow[]) {
        for (const s of (row.sessions ?? []) as StaffSession[]) {
          if (s.store && s.store.length >= 2) learnedStoreNames.add(s.store)
        }
      }
    }

    // 4. MIN_OCCURRENCES 이상 + dedup → dictionary 후보
    const candidates = Array.from(counter.values())
      .filter((c) => c.count >= MIN_OCCURRENCES)
      .sort((a, b) => b.count - a.count)
      .slice(0, MAX_NEW_ENTRIES)

    if (candidates.length === 0) {
      return NextResponse.json({
        ok: true, days, edits_scanned: scanned, new_entries: 0,
        skipped: "no recurring patterns above MIN_OCCURRENCES=2",
      })
    }

    // 5. 기존 store_paper_format 가져와서 merge
    const { data: fmtRow } = await supabase
      .from("store_paper_format")
      .select("symbol_dictionary, known_stores")
      .eq("store_uuid", auth.store_uuid)
      .maybeSingle()
    const existingFmt = fmtRow as {
      symbol_dictionary?: Record<string, unknown>
      known_stores?: string[] | null
    } | null
    const existingDict = existingFmt?.symbol_dictionary ?? {}
    const existingStores = new Set<string>(existingFmt?.known_stores ?? [])
    const newDict: Record<string, unknown> = { ...existingDict }
    let newCount = 0
    for (const c of candidates) {
      // raw 가 이미 있으면 skip (덮어쓰기 안 함 — 사용자 수동 등록 보호)
      if (c.raw in newDict) continue
      newDict[c.raw] = { [c.field]: c.value, learned: true, count: c.count }
      newCount++
    }

    // known_stores 누적 — edit 데이터에서 본 모든 store name 합집합.
    let newStoreCount = 0
    for (const sn of learnedStoreNames) {
      if (!existingStores.has(sn)) {
        existingStores.add(sn)
        newStoreCount++
      }
    }
    const finalKnownStores = Array.from(existingStores).sort()

    if (dryRun) {
      return NextResponse.json({
        ok: true, dry_run: true, days, edits_scanned: scanned,
        candidates: candidates.map((c) => ({ raw: c.raw, field: c.field, value: c.value, count: c.count })),
        would_add_dict: newCount,
        would_add_stores: newStoreCount,
        learned_store_names: Array.from(learnedStoreNames),
        learned_hostess_names: Array.from(learnedHostessNames),
      })
    }

    // 6. UPSERT store_paper_format (dict + stores 동시)
    if (newCount > 0 || newStoreCount > 0) {
      const nowIso = new Date().toISOString()
      const { error: upErr } = await supabase
        .from("store_paper_format")
        .upsert(
          {
            store_uuid: auth.store_uuid,
            symbol_dictionary: newDict,
            known_stores: finalKnownStores,
            updated_by: auth.user_id,
            updated_at: nowIso,
          },
          { onConflict: "store_uuid" },
        )
      if (upErr) {
        return NextResponse.json({ error: "DB_UPSERT_FAILED", message: upErr.message }, { status: 500 })
      }
    }

    await logAuditEvent(supabase, {
      auth,
      action: "paper_ledger_learn_run",
      entity_table: "paper_ledger_edits",
      entity_id: editIds[0] ?? auth.store_uuid,  // entity_id NOT NULL 충족
      status: "success",
      metadata: {
        days,
        edits_scanned: scanned,
        candidates: candidates.length,
        new_entries: newCount,
      },
    })

    return NextResponse.json({
      ok: true,
      days,
      edits_scanned: scanned,
      new_entries: newCount,
      new_known_stores: newStoreCount,
      total_dictionary_size: Object.keys(newDict).length,
      total_known_stores: finalKnownStores.length,
      candidates_preview: candidates.slice(0, 10).map((c) => ({
        raw: c.raw, field: c.field, value: c.value, count: c.count,
      })),
    })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
