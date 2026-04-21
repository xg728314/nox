import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { ReceiptType, ReceiptDocument } from "@/lib/receipt/types"

type WriteInput = {
  session_id: string
  store_uuid: string
  room_uuid: string
  receipt_id: string | null
  receiptType: ReceiptType
  document: ReceiptDocument
  user_id: string
}

type WriteSuccess = {
  snapshot: {
    id: string
    session_id: string
    store_uuid: string
    room_uuid: string
    receipt_type: string
    created_at: string
  }
  error?: never
}

type WriteFailure = {
  error: NextResponse
  snapshot?: never
}

/**
 * Upserts a receipt snapshot into receipt_snapshots.
 *
 * Extracts the persistence logic from receipt/route.ts POST handler (lines 361–397).
 * Uses upsert on session_id conflict (schema has UNIQUE(session_id)).
 * Preserves exact DB write order and error response shape.
 */
export async function writeReceiptSnapshot(
  supabase: SupabaseClient,
  input: WriteInput
): Promise<WriteSuccess | WriteFailure> {
  const now = new Date().toISOString()

  const { data: snapshot, error: snapshotInsertError } = await supabase
    .from("receipt_snapshots")
    .upsert(
      {
        session_id: input.session_id,
        store_uuid: input.store_uuid,
        room_uuid: input.room_uuid,
        receipt_id: input.receipt_id,
        receipt_type: input.receiptType,
        snapshot: input.document,
        created_by: input.user_id,
        created_at: now,
      },
      { onConflict: "session_id" }
    )
    .select("id, session_id, store_uuid, room_uuid, receipt_type, created_at")
    .single()

  if (snapshotInsertError || !snapshot) {
    const dbMsg = snapshotInsertError?.message ?? "unknown error"
    const dbCode = snapshotInsertError?.code ?? null
    const dbDetails = snapshotInsertError?.details ?? null
    const dbHint = snapshotInsertError?.hint ?? null
    console.error("[receipt POST] snapshot insert failed:", { dbMsg, dbCode, dbDetails, dbHint })
    return {
      error: NextResponse.json(
        {
          error: "SNAPSHOT_CREATE_FAILED",
          message: `Failed to create receipt snapshot: ${dbMsg}`,
          db_code: dbCode,
          db_details: dbDetails,
          db_hint: dbHint,
        },
        { status: 500 }
      ),
    }
  }

  return { snapshot }
}
