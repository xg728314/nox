import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { assertUuidForOr } from "@/lib/security/postgrestEscape"
import { cached } from "@/lib/cache/inMemoryTtl"

// 2026-05-03 R-Speed-x10: 이적 요청은 자주 polling 됨 (transfer 페이지).
//   approve 시점이 아니면 변동 없음. 5초 TTL + SWR 안전.
const TRANSFER_LIST_TTL_MS = 5000

export async function GET(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    // Role gate: owner/manager only
    if (authContext.role === "hostess") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Hostess role is not permitted to view transfer list." },
        { status: 403 }
      )
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const url = new URL(request.url)
    const statusFilter = url.searchParams.get("status") // pending, approved, cancelled
    const direction = url.searchParams.get("direction")  // from, to, all (default: all)

    // direction=all 일 때만 store_uuid OR 표현식 사용 → 사전 검증.
    let safeStoreUuidForOr: string | null = null
    if (direction !== "from" && direction !== "to") {
      safeStoreUuidForOr = assertUuidForOr(authContext.store_uuid)
      if (safeStoreUuidForOr === null) {
        return NextResponse.json(
          { error: "INTERNAL_ERROR", message: "Invalid store scope." },
          { status: 500 },
        )
      }
    }

    type TransferRow = {
      id: string
      hostess_membership_id: string
      from_store_uuid: string
      to_store_uuid: string
      business_day_id: string | null
      status: string
      from_store_approved_by: string | null
      from_store_approved_at: string | null
      to_store_approved_by: string | null
      to_store_approved_at: string | null
      reason: string | null
      created_at: string
      updated_at: string
    }

    const cacheKey = `${authContext.store_uuid}:${direction ?? "all"}:${statusFilter ?? ""}`
    const transfers = await cached<TransferRow[]>(
      "transfer_list",
      cacheKey,
      TRANSFER_LIST_TTL_MS,
      async () => {
        let query = supabase
          .from("transfer_requests")
          .select(
            "id, hostess_membership_id, from_store_uuid, to_store_uuid, business_day_id, status, from_store_approved_by, from_store_approved_at, to_store_approved_by, to_store_approved_at, reason, created_at, updated_at",
          )
          .order("created_at", { ascending: false })

        if (direction === "from") {
          query = query.eq("from_store_uuid", authContext.store_uuid)
        } else if (direction === "to") {
          query = query.eq("to_store_uuid", authContext.store_uuid)
        } else {
          query = query.or(
            `from_store_uuid.eq.${safeStoreUuidForOr},to_store_uuid.eq.${safeStoreUuidForOr}`,
          )
        }

        if (statusFilter) {
          query = query.eq("status", statusFilter)
        }

        const { data, error: fetchError } = await query
        if (fetchError) {
          throw new Error("FETCH_FAILED")
        }
        return (data ?? []) as TransferRow[]
      },
    )

    const res = NextResponse.json({
      store_uuid: authContext.store_uuid,
      count: transfers.length,
      transfers,
    })
    res.headers.set(
      "Cache-Control",
      "private, max-age=3, stale-while-revalidate=15",
    )
    return res

  } catch (error) {
    if (error instanceof AuthError) {
      const status =
        error.type === "AUTH_MISSING" ? 401 :
        error.type === "AUTH_INVALID" ? 401 :
        error.type === "MEMBERSHIP_NOT_FOUND" ? 403 :
        error.type === "MEMBERSHIP_INVALID" ? 403 :
        error.type === "MEMBERSHIP_NOT_APPROVED" ? 403 :
        error.type === "SERVER_CONFIG_ERROR" ? 500 : 500
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    if (error instanceof Error && error.message === "FETCH_FAILED") {
      return NextResponse.json(
        { error: "FETCH_FAILED", message: "Failed to fetch transfer requests." },
        { status: 500 },
      )
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "Unexpected error." }, { status: 500 })
  }
}
