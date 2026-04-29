/**
 * GET /api/super-admin/visualize/operating-days?store_uuid=...
 *
 * Read-only helper for the visualize money page. Lists recent operating
 * days for a store so the operator can pick a business_day_id without
 * pasting UUIDs by hand.
 *
 * Auth: super_admin only. No PII exposed.
 */

import { NextResponse } from "next/server"
import { visualizeGate, isUuid } from "@/lib/visualize/guards"

const DEFAULT_LIMIT = 30
const MAX_LIMIT = 90

export async function GET(request: Request) {
  const gate = await visualizeGate(request)
  if (!gate.ok) return gate.response
  const { client } = gate

  const url = new URL(request.url)
  const storeUuid = url.searchParams.get("store_uuid")
  if (!isUuid(storeUuid)) {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "store_uuid must be a valid UUID." },
      { status: 400 },
    )
  }
  const limitRaw = Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT)
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(MAX_LIMIT, Math.floor(limitRaw)))
    : DEFAULT_LIMIT

  const { data, error } = await client
    .from("store_operating_days")
    .select("id, business_date, status, opened_at, closed_at")
    .eq("store_uuid", storeUuid)
    .is("deleted_at", null)
    .order("business_date", { ascending: false })
    .limit(limit)

  if (error) {
    return NextResponse.json(
      { error: "QUERY_FAILED", message: error.message },
      { status: 500 },
    )
  }

  return NextResponse.json(
    {
      as_of: new Date().toISOString(),
      store_uuid: storeUuid,
      operating_days: data ?? [],
    },
    { headers: { "Cache-Control": "private, max-age=10" } },
  )
}
