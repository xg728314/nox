import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Checks if the latest receipt for a session is finalized.
 *
 * Returns a 409 ALREADY_FINALIZED response if finalized, null otherwise.
 * Extracts the repeated finalized-receipt guard pattern.
 */
export async function guardFinalizedReceipt(
  supabase: SupabaseClient,
  session_id: string,
  store_uuid: string
): Promise<NextResponse | null> {
  const { data: latestReceipt } = await supabase
    .from("receipts")
    .select("id, status")
    .eq("session_id", session_id)
    .eq("store_uuid", store_uuid)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (latestReceipt && latestReceipt.status === "finalized") {
    return NextResponse.json(
      {
        error: "ALREADY_FINALIZED",
        message: "정산이 확정되어 수정할 수 없습니다.",
      },
      { status: 409 }
    )
  }

  return null
}
