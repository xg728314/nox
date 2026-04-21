import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"

type SessionRow = {
  id: string
  store_uuid: string
  room_uuid: string
  status: string
  business_day_id: string | null
  manager_membership_id: string | null
  [key: string]: unknown
}

type LoadResult =
  | { session: SessionRow; error?: never }
  | { session?: never; error: NextResponse }

/**
 * Loads a session by id and enforces store_uuid scope.
 *
 * Returns the session row or an error NextResponse (404/403/400).
 * Extracts the repeated session-lookup + store-scope-guard pattern.
 */
export async function loadSessionScoped(
  supabase: SupabaseClient,
  session_id: string,
  store_uuid: string,
  opts?: { requireStatus?: string }
): Promise<LoadResult> {
  const { data: session, error: sessionError } = await supabase
    .from("room_sessions")
    .select("id, store_uuid, room_uuid, status, business_day_id, manager_membership_id")
    .eq("id", session_id)
    .maybeSingle()

  if (sessionError || !session) {
    return {
      error: NextResponse.json(
        { error: "SESSION_NOT_FOUND", message: "Session not found." },
        { status: 404 }
      ),
    }
  }

  if (session.store_uuid !== store_uuid) {
    return {
      error: NextResponse.json(
        { error: "STORE_MISMATCH", message: "Session does not belong to your store." },
        { status: 403 }
      ),
    }
  }

  if (opts?.requireStatus && session.status !== opts.requireStatus) {
    return {
      error: NextResponse.json(
        {
          error: `SESSION_NOT_${opts.requireStatus.toUpperCase()}`,
          message: `Session is not ${opts.requireStatus}.`,
        },
        { status: 400 }
      ),
    }
  }

  return { session: session as SessionRow }
}
