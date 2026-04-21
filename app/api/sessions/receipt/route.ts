import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { parseJsonBody } from "@/lib/session/parseBody"
import { handleRouteError } from "@/lib/session/handleAuthError"
import { writeSessionAudit } from "@/lib/session/auditWriter"
import { resolveOwnerVisibility } from "@/lib/settlement/services/ownerVisibility"
import { buildReceiptDocument } from "@/lib/receipt/services/buildReceiptDocument"
import { formatRoomLabel } from "@/lib/rooms/formatRoomLabel"
import { writeReceiptSnapshot } from "@/lib/receipt/services/snapshotWriter"
import type { ReceiptType, ReceiptCalcMode } from "@/lib/receipt/types"

/**
 * POST /api/sessions/receipt — Create receipt snapshot (interim or final)
 * GET  /api/sessions/receipt?session_id=xxx&snapshot_id=xxx — Retrieve snapshot for re-print
 */

export async function GET(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    if (authContext.role === "hostess") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const sessionId = searchParams.get("session_id")
    const snapshotId = searchParams.get("snapshot_id")

    if (!sessionId && !snapshotId) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "session_id or snapshot_id is required." },
        { status: 400 }
      )
    }

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    // Owner visibility: look up manager toggles
    const { showManager: ownerShowManager, showHostess: ownerShowHostess } = authContext.role === "owner"
      ? await resolveOwnerVisibility(supabase, authContext.store_uuid)
      : { showManager: true, showHostess: true }

    function stripSnapshotForOwner(snap: { snapshot: Record<string, unknown> | null }) {
      if (!snap.snapshot) return
      const doc = snap.snapshot
      if (doc.settlement) {
        const s = doc.settlement as Record<string, unknown>
        const stripped: Record<string, unknown> = {
          gross_total: s.gross_total,
          tc_amount: s.tc_amount,
          margin_amount: s.margin_amount,
        }
        if (ownerShowManager) stripped.manager_amount = s.manager_amount
        else stripped.manager_amount = 0
        if (ownerShowHostess) stripped.hostess_amount = s.hostess_amount
        else stripped.hostess_amount = 0
        doc.settlement = stripped
      }
      if (!ownerShowManager) delete doc.manager_total
    }

    if (snapshotId) {
      const { data: snap } = await supabase
        .from("receipt_snapshots")
        .select("id, session_id, store_uuid, room_uuid, receipt_type, snapshot, created_by, created_at")
        .eq("id", snapshotId)
        .eq("store_uuid", authContext.store_uuid)
        .maybeSingle()

      if (!snap) {
        return NextResponse.json({ error: "SNAPSHOT_NOT_FOUND" }, { status: 404 })
      }

      if (authContext.role === "owner") {
        stripSnapshotForOwner(snap as { snapshot: Record<string, unknown> | null })
      }

      return NextResponse.json({ snapshot: snap })
    }

    // List all snapshots for a session
    const { data: snapshots } = await supabase
      .from("receipt_snapshots")
      .select("id, session_id, store_uuid, room_uuid, receipt_type, snapshot, created_by, created_at")
      .eq("session_id", sessionId!)
      .eq("store_uuid", authContext.store_uuid)
      .order("created_at", { ascending: false })

    if (authContext.role === "owner") {
      for (const snap of (snapshots ?? []) as { snapshot: Record<string, unknown> | null }[]) {
        stripSnapshotForOwner(snap)
      }
    }

    return NextResponse.json({ snapshots: snapshots ?? [] })
  } catch (error) {
    return handleRouteError(error, "receipt")
  }
}

export async function POST(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    if (authContext.role === "hostess") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Hostess role is not permitted to generate receipts." },
        { status: 403 }
      )
    }

    const parsed = await parseJsonBody<{ session_id?: string; receipt_type?: ReceiptType; calc_mode?: ReceiptCalcMode }>(request)
    if (parsed.error) return parsed.error
    const body = parsed.body

    const { session_id } = body
    const receiptType: ReceiptType = body.receipt_type === "interim" ? "interim" : "final"
    const calcMode: ReceiptCalcMode =
      receiptType === "interim" && body.calc_mode === "half_ticket" ? "half_ticket" : "elapsed"

    if (!session_id) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "session_id is required." },
        { status: 400 }
      )
    }

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    // 1. Look up session
    const { data: session, error: sessionError } = await supabase
      .from("room_sessions")
      .select("id, store_uuid, room_uuid, started_at, ended_at, status, manager_name, customer_name_snapshot, customer_party_size")
      .eq("id", session_id)
      .maybeSingle()

    if (sessionError || !session) {
      return NextResponse.json(
        { error: "SESSION_NOT_FOUND", message: "Session not found." },
        { status: 404 }
      )
    }

    if (session.store_uuid !== authContext.store_uuid) {
      return NextResponse.json(
        { error: "STORE_MISMATCH", message: "Session does not belong to your store." },
        { status: 403 }
      )
    }

    // 2. Fetch room label
    const { data: room } = await supabase
      .from("rooms")
      .select("room_no, room_name")
      .eq("id", session.room_uuid)
      .maybeSingle()

    const roomLabel = formatRoomLabel(room)

    // 2.5 Fetch store display name
    const { data: storeRow } = await supabase
      .from("stores")
      .select("store_name")
      .eq("id", authContext.store_uuid)
      .maybeSingle()
    const storeName: string | null = storeRow?.store_name ?? null

    // 3. Fetch receipt (settlement data) — optional for interim
    const { data: receipt } = await supabase
      .from("receipts")
      .select("id, gross_total, tc_amount, manager_amount, hostess_amount, margin_amount, order_total_amount, participant_total_amount, status, payment_method, card_fee_amount")
      .eq("session_id", session_id)
      .eq("store_uuid", authContext.store_uuid)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (receiptType === "final" && !receipt) {
      console.warn("[receipt POST] final receipt requested without settlement row; generating from live snapshot", { session_id })
    }

    // 4. Build receipt document (extracted service)
    const { document, participantSnapshots, orderSnapshots } = await buildReceiptDocument({
      supabase,
      session: {
        session_id,
        store_uuid: session.store_uuid,
        room_uuid: session.room_uuid,
        started_at: session.started_at,
        ended_at: session.ended_at,
        manager_name: session.manager_name,
        customer_name_snapshot: session.customer_name_snapshot,
        customer_party_size: session.customer_party_size,
      },
      roomLabel,
      storeName,
      receipt: receipt ? {
        id: receipt.id,
        gross_total: receipt.gross_total,
        tc_amount: receipt.tc_amount,
        manager_amount: receipt.manager_amount,
        hostess_amount: receipt.hostess_amount,
        margin_amount: receipt.margin_amount,
        payment_method: receipt.payment_method,
        card_fee_amount: receipt.card_fee_amount,
      } : null,
      receiptType,
      calcMode,
      user_id: authContext.user_id,
    })

    // 5. Write snapshot (extracted service)
    const writeResult = await writeReceiptSnapshot(supabase, {
      session_id,
      store_uuid: authContext.store_uuid,
      room_uuid: session.room_uuid,
      receipt_id: receipt?.id ?? null,
      receiptType,
      document,
      user_id: authContext.user_id,
    })
    if (writeResult.error) return writeResult.error
    const snapshot = writeResult.snapshot

    // Patch snapshot_id into document
    document.snapshot_id = snapshot.id

    // 6. Audit event
    await writeSessionAudit(supabase, {
      auth: authContext,
      session_id,
      entity_table: "receipt_snapshots",
      entity_id: snapshot.id,
      action: "receipt_snapshot_created",
      after: {
        snapshot_id: snapshot.id,
        receipt_type: receiptType,
        receipt_id: receipt?.id ?? null,
        session_id,
        room_uuid: session.room_uuid,
        participants_count: participantSnapshots.length,
        orders_count: orderSnapshots.length,
        grand_total: document.grand_total,
        created_at: document.created_at,
      },
    })

    // 7. Owner visibility strip
    const responseDoc = { ...document }
    if (authContext.role === "owner") {
      const { showManager: showMgr, showHostess: showHst } = await resolveOwnerVisibility(supabase, authContext.store_uuid)
      if (responseDoc.settlement) {
        responseDoc.settlement = {
          gross_total: responseDoc.settlement.gross_total,
          tc_amount: responseDoc.settlement.tc_amount,
          margin_amount: responseDoc.settlement.margin_amount,
          manager_amount: showMgr ? responseDoc.settlement.manager_amount : 0,
          hostess_amount: showHst ? responseDoc.settlement.hostess_amount : 0,
        }
      }
      if (!showMgr) delete responseDoc.manager_total
    }

    return NextResponse.json(
      {
        snapshot_id: snapshot.id,
        receipt_type: snapshot.receipt_type,
        session_id: snapshot.session_id,
        room_uuid: snapshot.room_uuid,
        store_uuid: snapshot.store_uuid,
        created_at: snapshot.created_at,
        document: responseDoc,
      },
      { status: 201 }
    )
  } catch (error) {
    return handleRouteError(error, "receipt")
  }
}
