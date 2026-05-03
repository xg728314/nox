import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { handleRouteError } from "@/lib/session/handleAuthError"
import { resolveStoreNames, resolveHostessNames } from "@/lib/cross-store/queries/loadCrossStoreScoped"
import { cached } from "@/lib/cache/inMemoryTtl"

// 2026-05-03 R-Speed-x10: 타매장 작업기록 — 이적 페이지 polling.
//   business_day_id 가 closed 면 사실상 immutable, open 이면 5초 TTL 안전.
const RECORDS_TTL_MS = 5000

export async function GET(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    if (authContext.role === "hostess") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Hostess cannot view cross-store work records." },
        { status: 403 }
      )
    }

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    const { searchParams } = new URL(request.url)
    const scope = searchParams.get("scope") || "working"
    const statusFilter = searchParams.get("status")
    const businessDayId = searchParams.get("business_day_id")

    const cacheKey = `${authContext.store_uuid}:${scope}:${statusFilter ?? ""}:${businessDayId ?? ""}`

    type RecordRow = {
      id: string
      session_id: string
      business_day_id: string
      working_store_uuid: string
      origin_store_uuid: string
      hostess_membership_id: string
      requested_by: string
      approved_by: string | null
      approved_at: string | null
      status: string
      reject_reason: string | null
      created_at: string
    }
    type EnrichedRecord = RecordRow & {
      hostess_name: string | null
      working_store_name: string | null
      origin_store_name: string | null
    }
    type Payload = {
      store_uuid: string
      scope: string
      count: number
      records: EnrichedRecord[]
    }

    const payload = await cached<Payload>(
      "cross_store_records",
      cacheKey,
      RECORDS_TTL_MS,
      async () => {
        let query = supabase
          .from("cross_store_work_records")
          .select(
            "id, session_id, business_day_id, working_store_uuid, origin_store_uuid, hostess_membership_id, requested_by, approved_by, approved_at, status, reject_reason, created_at",
          )
          .is("deleted_at", null)
          .order("created_at", { ascending: false })

        if (scope === "origin") {
          query = query.eq("origin_store_uuid", authContext.store_uuid)
        } else {
          query = query.eq("working_store_uuid", authContext.store_uuid)
        }

        if (statusFilter) {
          query = query.eq("status", statusFilter)
        }
        if (businessDayId) {
          query = query.eq("business_day_id", businessDayId)
        }

        const { data: records, error: queryError } = await query

        if (queryError) {
          throw new Error(`QUERY_FAILED:${queryError.message}`)
        }

        const recordsRows = (records ?? []) as RecordRow[]

        // 2026-05-03 R-Speed-x10: hostess + store name lookup 병렬화 (직렬 → 1 wave).
        const hostessIds = [
          ...new Set(recordsRows.map((r) => r.hostess_membership_id)),
        ]
        const storeIdsSet = new Set<string>()
        for (const r of recordsRows) {
          storeIdsSet.add(r.working_store_uuid)
          storeIdsSet.add(r.origin_store_uuid)
        }
        const storeIds = [...storeIdsSet]

        const [nameMap, storeNameMap] = await Promise.all([
          resolveHostessNames(supabase, authContext.store_uuid, hostessIds),
          resolveStoreNames(supabase, storeIds),
        ])

        const enrichedRecords: EnrichedRecord[] = recordsRows.map((r) => ({
          ...r,
          hostess_name: nameMap.get(r.hostess_membership_id) || null,
          working_store_name: storeNameMap.get(r.working_store_uuid) || null,
          origin_store_name: storeNameMap.get(r.origin_store_uuid) || null,
        }))

        return {
          store_uuid: authContext.store_uuid,
          scope,
          count: enrichedRecords.length,
          records: enrichedRecords,
        }
      },
    )

    const res = NextResponse.json(payload)
    res.headers.set(
      "Cache-Control",
      "private, max-age=3, stale-while-revalidate=15",
    )
    return res
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("QUERY_FAILED:")) {
      return NextResponse.json(
        { error: "QUERY_FAILED", message: error.message.slice("QUERY_FAILED:".length) },
        { status: 500 },
      )
    }
    return handleRouteError(error, "cross-store/records")
  }
}
