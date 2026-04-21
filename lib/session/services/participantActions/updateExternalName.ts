import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { AuthContext } from "@/lib/auth/resolveAuthContext"
import { assertBusinessDayOpen } from "@/lib/auth/assertBusinessDayOpen"
import { writeSessionAudit } from "@/lib/session/auditWriter"
import { resolveMatchStatus } from "@/lib/matching"

/**
 * Action: update_external_name — full self-contained handler.
 *
 * This action has its own participant/session lookup, auth rules, and response shape,
 * so it returns a complete NextResponse rather than just an update payload.
 */
export async function handleUpdateExternalName(
  supabase: SupabaseClient,
  authContext: AuthContext,
  participant_id: string,
  externalName?: string
): Promise<NextResponse> {
  const { data: p } = await supabase
    .from("session_participants")
    .select("id, session_id, external_name, origin_store_uuid, store_uuid, manager_membership_id")
    .eq("id", participant_id)
    .is("deleted_at", null)
    .maybeSingle()

  if (!p) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
  }

  const { data: session } = await supabase
    .from("room_sessions")
    .select("id, store_uuid, business_day_id")
    .eq("id", p.session_id)
    .maybeSingle()

  if (!session) {
    return NextResponse.json({ error: "NOT_FOUND", message: "Session not found." }, { status: 404 })
  }

  // Business day closure guard
  {
    const guard = await assertBusinessDayOpen(supabase, session.business_day_id)
    if (guard) return guard
  }

  // Permission check
  const isSessionStore = session.store_uuid === authContext.store_uuid
  const isOriginManagerSelf = !!(
    p.origin_store_uuid &&
    p.origin_store_uuid === authContext.store_uuid &&
    p.manager_membership_id &&
    p.manager_membership_id === authContext.membership_id
  )
  if (!isSessionStore && !isOriginManagerSelf) {
    return NextResponse.json({ error: "FORBIDDEN", message: "Not authorized to edit this participant name." }, { status: 403 })
  }

  const beforeName = p.external_name ?? null
  const afterName = externalName ?? null

  await supabase
    .from("session_participants")
    .update({ external_name: afterName, updated_at: new Date().toISOString() })
    .eq("id", participant_id)

  // Match resolution against store hostess names
  const targetStoreUuid = p.origin_store_uuid ?? session.store_uuid
  const { data: storeMemberships } = await supabase
    .from("store_memberships")
    .select("id")
    .eq("store_uuid", targetStoreUuid)
    .eq("role", "hostess")
    .is("deleted_at", null)
  const mIds = (storeMemberships ?? []).map((m: { id: string }) => m.id)
  const hostessNames = new Set<string>()
  if (mIds.length > 0) {
    const { data: hsts } = await supabase
      .from("hostesses")
      .select("name, stage_name")
      .in("membership_id", mIds)
    for (const h of hsts ?? []) {
      if (h.name) hostessNames.add(h.name)
      if (h.stage_name) hostessNames.add(h.stage_name)
    }
  }
  const beforeMatch = resolveMatchStatus(beforeName, hostessNames)
  const afterMatch = resolveMatchStatus(afterName, hostessNames)

  if (beforeName !== afterName) {
    await writeSessionAudit(supabase, {
      auth: authContext,
      session_id: p.session_id,
      entity_table: "session_participants",
      entity_id: participant_id,
      action: "update_external_name",
      before: { external_name: beforeName, match_status: beforeMatch.status },
      after: { external_name: afterName, match_status: afterMatch.status, match_candidates: afterMatch.candidates },
    })
  }

  return NextResponse.json({
    participant_id,
    external_name: afterName,
    match_status: afterMatch.status,
    match_candidates: afterMatch.candidates,
  })
}
