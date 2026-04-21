import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { isValidUUID } from "@/lib/validation"

/**
 * STEP-011A: settlement foundation — per-session settlement endpoints.
 *
 *   POST /api/sessions/[session_id]/settlement
 *     Creates or rebuilds a DRAFT settlement for a session. If no live
 *     settlement exists, a new draft is inserted. If a draft exists, the
 *     header is recomputed and settlement_items are soft-deleted + rebuilt.
 *     confirmed / paid settlements are immutable — rebuild returns 409.
 *
 *   GET /api/sessions/[session_id]/settlement
 *     Returns the live (deleted_at IS NULL) settlement header plus its
 *     items.
 *
 * Coexistence note:
 *   The legacy POST /api/sessions/settlement route (body-based, writes
 *   receipts / receipt_snapshots) is untouched. This new route writes the
 *   new settlements / settlement_items tables introduced by migration 032
 *   and is purely additive — the legacy counter/checkout flow is not
 *   affected.
 *
 * Security:
 *   - resolveAuthContext required.
 *   - Every SELECT/INSERT/UPDATE is store_uuid scoped.
 *   - membership_id / store_uuid are NEVER read from the request body —
 *     both come from AuthContext.
 *   - Session must belong to the caller's store. Cross-store sessions
 *     return 404 ROOM/SESSION_NOT_FOUND.
 */

type Params = { params: Promise<{ session_id: string }> }

// STEP-011B-FIX: settlement aggregation reads normalized share rows.
// The legacy manager/store columns on session_participants are no longer
// authoritative — only hostess_share_amount is read from the participant
// row. Manager money comes from session_manager_shares, store money from
// session_store_shares.
type ParticipantRow = {
  id: string
  membership_id: string | null
  hostess_share_amount: number | string | null
  share_type: string | null
}

type ManagerShareRow = {
  id: string
  manager_membership_id: string
  amount: number | string
  source_type: string
}

type StoreShareRow = {
  id: string
  amount: number | string
  source_type: string
}

type SettlementRow = {
  id: string
  store_uuid: string
  session_id: string
  status: string
  total_amount: number | string
  manager_amount: number | string
  hostess_amount: number | string
  store_amount: number | string
  confirmed_at: string | null
  created_at: string
  updated_at: string
}

type SettlementItemRow = {
  id: string
  settlement_id: string
  store_uuid: string
  participant_id: string | null
  membership_id: string | null
  role_type: string
  amount: number | string
  account_id: string | null
  payee_account_id: string | null
  note: string | null
  created_at: string
  updated_at: string
}

function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key)
}

function num(v: unknown): number {
  if (v == null) return 0
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

async function loadSessionInStore(
  supabase: ReturnType<typeof supa>,
  sessionId: string,
  storeUuid: string,
) {
  const { data } = await supabase
    .from("room_sessions")
    .select("id, store_uuid, status")
    .eq("id", sessionId)
    .eq("store_uuid", storeUuid)
    .maybeSingle()
  return data as { id: string; store_uuid: string; status: string | null } | null
}

export async function POST(request: Request, { params }: Params) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner" && auth.role !== "manager") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN", message: "Access denied." }, { status: 403 })
    }
    const { session_id } = await params
    if (!isValidUUID(session_id)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "invalid session id." }, { status: 400 })
    }

    const supabase = supa()

    // 1. Session must exist in caller's store.
    const session = await loadSessionInStore(supabase, session_id, auth.store_uuid)
    if (!session) {
      return NextResponse.json({ error: "SESSION_NOT_FOUND" }, { status: 404 })
    }

    // 2. Session must be in a settleable state. The legacy checkout flow
    //    marks the room_sessions row with a non-"active" status on close.
    //    Accept anything that is not actively open. Refusing to build for
    //    still-active sessions keeps unexpected in-flight totals out.
    if (session.status === "active") {
      return NextResponse.json(
        { error: "SESSION_STILL_ACTIVE", message: "세션이 아직 진행 중입니다." },
        { status: 409 }
      )
    }

    // 3. Existing live settlement — must be draft to allow rebuild.
    const { data: existingRaw } = await supabase
      .from("settlements")
      .select("id, store_uuid, session_id, status, total_amount, manager_amount, hostess_amount, store_amount, confirmed_at, created_at, updated_at")
      .eq("session_id", session_id)
      .eq("store_uuid", auth.store_uuid)
      .is("deleted_at", null)
      .maybeSingle()
    const existing = existingRaw as SettlementRow | null
    if (existing && existing.status !== "draft") {
      return NextResponse.json(
        { error: "SETTLEMENT_LOCKED", message: `정산이 이미 ${existing.status} 상태입니다.`, status: existing.status },
        { status: 409 }
      )
    }

    // 4. Source data — normalized share rows from three authoritative
    //    tables. No business formulas run here; this route purely
    //    aggregates what the STEP-011B-FIX calculator already persisted.
    const [
      { data: partsRaw },
      { data: managerSharesRaw },
      { data: storeSharesRaw },
      { data: ordersRaw },
    ] = await Promise.all([
      supabase
        .from("session_participants")
        .select("id, membership_id, hostess_share_amount, share_type")
        .eq("session_id", session_id)
        .eq("store_uuid", auth.store_uuid)
        .is("deleted_at", null),
      supabase
        .from("session_manager_shares")
        .select("id, manager_membership_id, amount, source_type")
        .eq("session_id", session_id)
        .eq("store_uuid", auth.store_uuid)
        .is("deleted_at", null),
      supabase
        .from("session_store_shares")
        .select("id, amount, source_type")
        .eq("session_id", session_id)
        .eq("store_uuid", auth.store_uuid)
        .is("deleted_at", null),
      supabase
        .from("orders")
        .select("qty, unit_price, customer_amount")
        .eq("session_id", session_id)
        .eq("store_uuid", auth.store_uuid)
        .is("deleted_at", null),
    ])
    const participants = (partsRaw ?? []) as ParticipantRow[]
    const managerShareRows = (managerSharesRaw ?? []) as ManagerShareRow[]
    const storeShareRows = (storeSharesRaw ?? []) as StoreShareRow[]

    // total_amount stays the pure order total (reporting-only figure).
    const total_amount = (ordersRaw ?? []).reduce((sum, o: { qty: number | null; unit_price: number | null; customer_amount: number | null }) => {
      const explicit = num(o.customer_amount)
      if (explicit > 0) return sum + explicit
      return sum + num(o.qty) * num(o.unit_price)
    }, 0)

    // Role totals from the three authoritative sources.
    const hostess_amount = participants.reduce((s, p) => s + num(p.hostess_share_amount), 0)
    const manager_amount = managerShareRows.reduce((s, r) => s + num(r.amount), 0)
    const store_amount = storeShareRows.reduce((s, r) => s + num(r.amount), 0)

    const nowIso = new Date().toISOString()

    // 5. Insert or update header. For rebuild, replace in place (same id)
    //    so external references to the settlement remain stable.
    let settlementId: string
    if (existing) {
      const { error: upErr } = await supabase
        .from("settlements")
        .update({
          total_amount,
          manager_amount,
          hostess_amount,
          store_amount,
          updated_at: nowIso,
        })
        .eq("id", existing.id)
        .eq("store_uuid", auth.store_uuid)
      if (upErr) {
        return NextResponse.json({ error: "UPDATE_FAILED", message: upErr.message }, { status: 500 })
      }
      settlementId = existing.id

      // Soft-delete the prior draft's items before rebuild.
      await supabase
        .from("settlement_items")
        .update({ deleted_at: nowIso, updated_at: nowIso })
        .eq("settlement_id", existing.id)
        .eq("store_uuid", auth.store_uuid)
        .is("deleted_at", null)
    } else {
      const { data: created, error: insErr } = await supabase
        .from("settlements")
        .insert({
          store_uuid: auth.store_uuid,
          session_id,
          status: "draft",
          total_amount,
          manager_amount,
          hostess_amount,
          store_amount,
        })
        .select("id")
        .single()
      if (insErr || !created) {
        return NextResponse.json({ error: "CREATE_FAILED", message: insErr?.message }, { status: 500 })
      }
      settlementId = created.id
    }

    // 6. Build settlement_items from the normalized sources.
    //    - hostess rows from session_participants.hostess_share_amount
    //    - manager rows from session_manager_shares (one item per live row)
    //    - store   rows from session_store_shares   (one item per live row)
    //    No formulas here; strict 1:1 mapping.
    const itemsToInsert: Array<{
      settlement_id: string
      store_uuid: string
      participant_id: string | null
      membership_id: string | null
      role_type: string
      amount: number
      note: string | null
    }> = []
    for (const p of participants) {
      const hst = num(p.hostess_share_amount)
      if (hst > 0) {
        itemsToInsert.push({
          settlement_id: settlementId,
          store_uuid: auth.store_uuid,
          participant_id: p.id,
          membership_id: p.membership_id,
          role_type: "hostess",
          amount: hst,
          note: null,
        })
      }
    }
    for (const r of managerShareRows) {
      const amt = num(r.amount)
      if (amt <= 0) continue
      itemsToInsert.push({
        settlement_id: settlementId,
        store_uuid: auth.store_uuid,
        participant_id: null,
        membership_id: r.manager_membership_id,
        role_type: "manager",
        amount: amt,
        note: r.source_type || null,
      })
    }
    for (const r of storeShareRows) {
      const amt = num(r.amount)
      if (amt <= 0) continue
      itemsToInsert.push({
        settlement_id: settlementId,
        store_uuid: auth.store_uuid,
        participant_id: null,
        membership_id: null,
        role_type: "store",
        amount: amt,
        note: r.source_type || null,
      })
    }

    if (itemsToInsert.length > 0) {
      const { error: itemErr } = await supabase
        .from("settlement_items")
        .insert(itemsToInsert)
      if (itemErr) {
        return NextResponse.json({ error: "ITEM_INSERT_FAILED", message: itemErr.message }, { status: 500 })
      }
    }

    return NextResponse.json({
      settlement_id: settlementId,
      session_id,
      status: "draft",
      rebuilt: !!existing,
      totals: {
        total_amount,
        manager_amount,
        hostess_amount,
        store_amount,
      },
      item_count: itemsToInsert.length,
    })
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}

export async function GET(request: Request, { params }: Params) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner" && auth.role !== "manager") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN", message: "Access denied." }, { status: 403 })
    }
    const { session_id } = await params
    if (!isValidUUID(session_id)) {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    }

    const supabase = supa()

    // Store-scoped session existence check — prevents cross-store probes
    // from learning whether a foreign session has a settlement.
    const session = await loadSessionInStore(supabase, session_id, auth.store_uuid)
    if (!session) {
      return NextResponse.json({ error: "SESSION_NOT_FOUND" }, { status: 404 })
    }

    const { data: headerRaw } = await supabase
      .from("settlements")
      .select("id, store_uuid, session_id, status, total_amount, manager_amount, hostess_amount, store_amount, confirmed_at, created_at, updated_at")
      .eq("session_id", session_id)
      .eq("store_uuid", auth.store_uuid)
      .is("deleted_at", null)
      .maybeSingle()
    const header = headerRaw as SettlementRow | null
    if (!header) {
      return NextResponse.json({
        settlement: null,
        items: [],
        participant_totals: [],
      })
    }

    const { data: itemsRaw } = await supabase
      .from("settlement_items")
      .select("id, settlement_id, store_uuid, participant_id, membership_id, role_type, amount, account_id, payee_account_id, note, created_at, updated_at")
      .eq("settlement_id", header.id)
      .eq("store_uuid", auth.store_uuid)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
    const items = (itemsRaw ?? []) as SettlementItemRow[]

    // Participant-grouped totals for UI convenience.
    const byParticipant = new Map<string, { participant_id: string; total: number; per_role: Record<string, number> }>()
    for (const it of items) {
      const key = it.participant_id ?? "__unassigned__"
      const entry = byParticipant.get(key) ?? { participant_id: it.participant_id ?? "", total: 0, per_role: {} }
      const amt = num(it.amount)
      entry.total += amt
      entry.per_role[it.role_type] = (entry.per_role[it.role_type] ?? 0) + amt
      byParticipant.set(key, entry)
    }

    return NextResponse.json({
      settlement: header,
      items,
      participant_totals: [...byParticipant.values()],
    })
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
