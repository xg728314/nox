import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { handleRouteError } from "@/lib/session/handleAuthError"
import { isValidUUID } from "@/lib/validation"
import { logDeniedAudit } from "@/lib/audit/logEvent"
import { resolveStoreNames, resolveManagerNames } from "@/lib/cross-store/queries/loadCrossStoreScoped"

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await resolveAuthContext(request)

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    if (auth.role !== "owner") {
      await logDeniedAudit(supabase, {
        auth,
        action: "cross_store_forbidden",
        entity_table: "cross_store_settlements",
        reason: "ROLE_NOT_ALLOWED",
        metadata: { route: "GET /api/cross-store/[id]" },
      })
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 })
    }

    const { id } = await context.params
    if (!isValidUUID(id)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "invalid id" }, { status: 400 })
    }

    const { data: headerRaw } = await supabase
      .from("cross_store_settlements")
      .select("id, from_store_uuid, to_store_uuid, total_amount, prepaid_amount, remaining_amount, status, memo, created_by, created_at, updated_at")
      .eq("id", id)
      .eq("from_store_uuid", auth.store_uuid)
      .is("deleted_at", null)
      .maybeSingle()
    if (!headerRaw) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
    }
    const header = headerRaw as {
      id: string; from_store_uuid: string; to_store_uuid: string
      total_amount: number | string; prepaid_amount: number | string; remaining_amount: number | string
      status: string; memo: string | null; created_by: string | null; created_at: string; updated_at: string | null
    }

    const storeNameMap = await resolveStoreNames(supabase, [header.to_store_uuid])

    const { data: itemsRaw } = await supabase
      .from("cross_store_settlement_items")
      .select("id, manager_membership_id, amount, paid_amount, remaining_amount, status, created_at")
      .eq("cross_store_settlement_id", id)
      .eq("store_uuid", auth.store_uuid)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
    const items = (itemsRaw ?? []) as Array<{
      id: string; manager_membership_id: string | null; amount: number | string
      paid_amount: number | string; remaining_amount: number | string; status: string; created_at: string
    }>

    const mids = Array.from(new Set(items.map(i => i.manager_membership_id).filter((x): x is string => !!x)))
    const nameById = await resolveManagerNames(supabase, mids)

    const enrichedItems = items.map(it => ({
      ...it,
      manager_name: it.manager_membership_id ? (nameById[it.manager_membership_id] ?? it.manager_membership_id.slice(0, 8)) : null,
    }))

    return NextResponse.json({
      header: {
        ...header,
        to_store_name: storeNameMap.get(header.to_store_uuid) ?? header.to_store_uuid.slice(0, 8),
      },
      items: enrichedItems,
    })
  } catch (error) {
    return handleRouteError(error, "cross-store/[id]")
  }
}
