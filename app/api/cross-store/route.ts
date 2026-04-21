import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { handleRouteError } from "@/lib/session/handleAuthError"
import { logAuditEvent, logDeniedAudit } from "@/lib/audit/logEvent"
import {
  parseUuid,
  parsePositiveAmount,
  parseBoundedString,
  cheapHash,
  MEMO_MAX,
  CROSS_STORE_MAX_ITEMS,
} from "@/lib/security/guards"
import { ownerFinancialGuard } from "@/lib/cross-store/services/ownerFinancialGuard"
import { mapRpcError, type RpcErrorEntry } from "@/lib/cross-store/validators/validateCrossStoreInput"
import { resolveStoreNames } from "@/lib/cross-store/queries/loadCrossStoreScoped"

const RPC_ERROR_MAP: Record<string, RpcErrorEntry> = {
  STORE_NULL: { status: 400, error: "STORE_NULL" },
  SAME_STORE: { status: 400, error: "SAME_STORE" },
  TOTAL_INVALID: { status: 400, error: "TOTAL_INVALID" },
  ITEM_AMOUNT_INVALID: { status: 400, error: "ITEM_AMOUNT_INVALID" },
  MANAGER_NULL: { status: 400, error: "MANAGER_NULL" },
  SUM_MISMATCH: { status: 400, error: "SUM_MISMATCH" },
}

type InputItem = { manager_membership_id?: unknown; amount?: unknown }

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)

    if (auth.role !== "owner") {
      const svc = createServiceClient()
      if (!svc.error) {
        await logDeniedAudit(svc.supabase, {
          auth,
          action: "cross_store_forbidden",
          entity_table: "cross_store_settlements",
          reason: "ROLE_NOT_ALLOWED",
          metadata: { route: "GET /api/cross-store" },
        })
      }
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 })
    }

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    const { data: headersRaw } = await supabase
      .from("cross_store_settlements")
      .select("id, from_store_uuid, to_store_uuid, total_amount, prepaid_amount, remaining_amount, status, memo, created_by, created_at, updated_at")
      .eq("from_store_uuid", auth.store_uuid)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(500)

    const headers = (headersRaw ?? []) as Array<{
      id: string; from_store_uuid: string; to_store_uuid: string
      total_amount: number | string; prepaid_amount: number | string; remaining_amount: number | string
      status: string; memo: string | null; created_by: string | null; created_at: string; updated_at: string | null
    }>

    const toIds = Array.from(new Set(headers.map(h => h.to_store_uuid).filter(Boolean)))
    const storeNameMap = await resolveStoreNames(supabase, toIds)

    const settlements = headers.map(h => ({
      ...h,
      to_store_name: storeNameMap.get(h.to_store_uuid) ?? h.to_store_uuid.slice(0, 8),
    }))

    return NextResponse.json({ settlements })
  } catch (error) {
    return handleRouteError(error, "cross-store")
  }
}

export async function POST(request: Request) {
  try {
    const auth = await resolveAuthContext(request)

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>

    const to_store_uuid = parseUuid(body.to_store_uuid)
    if (!to_store_uuid) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "to_store_uuid must be a valid uuid." }, { status: 400 })
    }
    if (to_store_uuid === auth.store_uuid) {
      return NextResponse.json({ error: "SAME_STORE", message: "to_store_uuid must differ from caller store." }, { status: 400 })
    }

    const total_amount = parsePositiveAmount(body.total_amount)
    if (total_amount == null) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "total_amount must be a finite positive number within bounds." }, { status: 400 })
    }

    const memo = body.memo == null ? null : parseBoundedString(body.memo, MEMO_MAX)
    if (body.memo != null && memo === null) {
      return NextResponse.json({ error: "BAD_REQUEST", message: `memo must be non-empty and ≤ ${MEMO_MAX} chars.` }, { status: 400 })
    }

    const rawItems = Array.isArray(body.items) ? (body.items as InputItem[]) : []
    if (rawItems.length === 0) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "items required (non-empty)." }, { status: 400 })
    }
    if (rawItems.length > CROSS_STORE_MAX_ITEMS) {
      return NextResponse.json({ error: "BAD_REQUEST", message: `items exceed max (${CROSS_STORE_MAX_ITEMS}).` }, { status: 400 })
    }

    const parsedItems: Array<{ manager_membership_id: string; amount: number }> = []
    let sum = 0
    for (const it of rawItems) {
      const amt = parsePositiveAmount(it.amount)
      if (amt == null) {
        return NextResponse.json({ error: "BAD_REQUEST", message: "item.amount must be > 0 within bounds." }, { status: 400 })
      }
      const mgr = parseUuid(it.manager_membership_id)
      if (!mgr) {
        return NextResponse.json({ error: "BAD_REQUEST", message: "item.manager_membership_id must be a valid uuid." }, { status: 400 })
      }
      parsedItems.push({ manager_membership_id: mgr, amount: amt })
      sum += amt
    }

    if (Math.abs(sum - total_amount) > 0.0001) {
      return NextResponse.json(
        { error: "SUM_MISMATCH", message: `items 합계 (${sum}) 가 total_amount (${total_amount}) 와 일치하지 않습니다.` },
        { status: 400 }
      )
    }

    // Owner + reauth + rate limit + dup guard + biz day
    const dupKey = cheapHash(`${to_store_uuid}|${total_amount}|${parsedItems.map(i => i.manager_membership_id + ":" + i.amount).join(",")}|${memo ?? ""}`)
    const guard = await ownerFinancialGuard({
      auth,
      supabase,
      routeLabel: "cross_store_create",
      entityTable: "cross_store_settlements",
      rateLimitKey: `cross-store-create:${auth.user_id}`,
      rateLimitPerMin: 10,
      dupKey: `cross-store-create-dup:${auth.user_id}:${dupKey}`,
      dupWindowMs: 5000,
    })
    if (guard.error) return guard.error

    const { data, error } = await supabase.rpc("create_cross_store_settlement", {
      p_from_store_uuid: auth.store_uuid,
      p_to_store_uuid: to_store_uuid,
      p_total_amount: total_amount,
      p_memo: memo,
      p_created_by: auth.user_id,
      p_items: parsedItems,
    })

    if (error) {
      const mapped = mapRpcError(error.message ?? "", RPC_ERROR_MAP)
      return NextResponse.json({ error: mapped.error, message: mapped.message }, { status: mapped.status })
    }

    const result = (data ?? {}) as Record<string, unknown>
    const headerId = typeof result.id === "string" ? result.id : null

    await logAuditEvent(supabase, {
      auth,
      action: "cross_store_settlement_created",
      entity_table: "cross_store_settlements",
      entity_id: headerId ?? auth.store_uuid,
      status: "success",
      metadata: { to_store_uuid, total_amount, item_count: parsedItems.length },
      reason: memo,
    })

    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    return handleRouteError(error, "cross-store")
  }
}
