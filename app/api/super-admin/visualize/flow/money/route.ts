/**
 * GET /api/super-admin/visualize/flow/money
 *
 * Phase 1 — money flow Sankey data for one store + one business day.
 * READ-ONLY. Stored values only. No recalculation. Audit-logged.
 *
 * Query params:
 *   store_uuid       UUID, required
 *   business_day_id  UUID, required
 *   unmask           'true', optional (Phase 1 unused — no PII in response)
 *
 * Auth: super_admin only (visualizeGate enforces). All other callers 403.
 *
 * Response: lib/visualize/shapes.ts → MoneyFlowResponse
 */

import { NextResponse } from "next/server"
import {
  visualizeGate,
  writeVisualizeAudit,
  isUuid,
} from "@/lib/visualize/guards"
import { queryMoneyFlow } from "@/lib/visualize/query/money"

export async function GET(request: Request) {
  const gate = await visualizeGate(request)
  if (!gate.ok) return gate.response
  const { auth, client } = gate

  const url = new URL(request.url)
  const storeUuid = url.searchParams.get("store_uuid")
  const businessDayId = url.searchParams.get("business_day_id")
  const unmaskRequested = url.searchParams.get("unmask") === "true"

  if (!isUuid(storeUuid)) {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "store_uuid must be a valid UUID." },
      { status: 400 },
    )
  }
  if (!isUuid(businessDayId)) {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "business_day_id must be a valid UUID." },
      { status: 400 },
    )
  }

  let result
  try {
    result = await queryMoneyFlow({
      client,
      store_uuid: storeUuid,
      business_day_id: businessDayId,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const stack = e instanceof Error ? e.stack : undefined
    console.error(`[visualize.money] threw: ${msg}\n${stack ?? ""}`)
    await writeVisualizeAudit({
      auth,
      client,
      action: "visualize_money_read",
      entity_id: businessDayId,
      scope_store_uuid: storeUuid,
      metadata: { outcome: "threw", error: msg },
      unmasked: false,
    })
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Money flow query crashed.", detail: msg },
      { status: 500 },
    )
  }

  if (!result.ok) {
    console.warn(
      `[visualize.money] failed: ${result.error} — ${result.message}`,
    )
    await writeVisualizeAudit({
      auth,
      client,
      action: "visualize_money_read",
      entity_id: businessDayId,
      scope_store_uuid: storeUuid,
      metadata: { outcome: "failed", error: result.error, message: result.message },
      unmasked: false,
    })
    return NextResponse.json(
      { error: result.error, message: result.message },
      { status: result.status },
    )
  }

  await writeVisualizeAudit({
    auth,
    client,
    action: "visualize_money_read",
    entity_id: businessDayId,
    scope_store_uuid: storeUuid,
    metadata: {
      outcome: "success",
      node_count: result.data.nodes.length,
      link_count: result.data.links.length,
      warning_count: result.data.warnings.length,
      unmask_requested: unmaskRequested,
    },
    unmasked: false, // Phase 1 surfaces no PII regardless of unmask param
  })

  return NextResponse.json(result.data, {
    status: 200,
    headers: {
      "Cache-Control": "private, max-age=10",
    },
  })
}
