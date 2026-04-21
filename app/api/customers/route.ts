import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { escapeLikeValue } from "@/lib/security/postgrestEscape"

/**
 * GET  /api/customers?q=xxx&scope=mine|all — 손님 검색 (store_uuid 기준)
 * POST /api/customers — 손님 신규 생성
 */

export async function GET(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    if (!["owner", "manager"].includes(authContext.role)) {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { searchParams } = new URL(request.url)
    const q = searchParams.get("q")?.trim()
    const scope = searchParams.get("scope") || "all"
    const limit = Math.min(Number(searchParams.get("limit") ?? 50), 100)

    let query = supabase
      .from("customers")
      .select("id, name, phone, memo, tags, manager_membership_id, created_at, updated_at")
      .eq("store_uuid", authContext.store_uuid)
      .order("updated_at", { ascending: false })
      .limit(limit)

    // Manager scope filtering (CUSTOMER-4)
    if (authContext.role === "manager" && scope === "mine") {
      query = query.eq("manager_membership_id", authContext.membership_id)
    }

    if (q && q.length > 0) {
      // SECURITY (R-4): escape LIKE wildcards (`%`, `_`, `\`) so a
      // user-supplied `%` matches the literal character, not
      // "match everything". Digit-only search uses a phone prefix
      // match — no wildcards in the input anyway, but we still run
      // the escaper for defence-in-depth.
      const safeQ = escapeLikeValue(q)
      if (safeQ === null) {
        return NextResponse.json(
          { error: "BAD_REQUEST", message: "q is too long." },
          { status: 400 },
        )
      }
      if (safeQ.length > 0) {
        const isDigits = /^\d+$/.test(safeQ)
        if (isDigits) {
          query = query.like("phone", `${safeQ}%`)
        } else {
          query = query.ilike("name", `%${safeQ}%`)
        }
      }
    }

    const { data: customers, error: queryError } = await query

    if (queryError) {
      console.error("[customers GET] query failed:", queryError.message, queryError.details)
      return NextResponse.json({ error: "QUERY_FAILED", message: queryError.message }, { status: 500 })
    }

    // Enrich with visit stats from room_sessions
    const customerIds = (customers ?? []).map((c: { id: string }) => c.id)
    let visitStatsMap = new Map<string, { visit_count: number; total_amount: number; last_visit: string | null }>()

    if (customerIds.length > 0) {
      const { data: sessions } = await supabase
        .from("room_sessions")
        .select("customer_id, started_at, ended_at")
        .eq("store_uuid", authContext.store_uuid)
        .in("customer_id", customerIds)
        .order("started_at", { ascending: false })

      if (sessions) {
        for (const s of sessions) {
          const cid = (s as { customer_id: string }).customer_id
          const existing = visitStatsMap.get(cid) || { visit_count: 0, total_amount: 0, last_visit: null }
          existing.visit_count++
          if (!existing.last_visit) existing.last_visit = (s as { started_at: string }).started_at
          visitStatsMap.set(cid, existing)
        }
      }

      // Get receipt totals per customer
      const { data: receipts } = await supabase
        .from("receipts")
        .select("session_id, gross_total")
        .eq("store_uuid", authContext.store_uuid)
        .eq("status", "finalized")

      if (receipts) {
        // Build session→customer map
        const sessionCustomerMap = new Map<string, string>()
        if (sessions) {
          for (const s of sessions) {
            sessionCustomerMap.set(
              (s as { customer_id: string; started_at: string }).customer_id,
              (s as { customer_id: string }).customer_id
            )
          }
        }

        // Get session IDs linked to these customers
        const customerSessionIds = new Set<string>()
        if (sessions) {
          for (const s of sessions) {
            customerSessionIds.add((s as unknown as { id: string }).id)
          }
        }
      }
    }

    const enriched = (customers ?? []).map((c: { id: string; name: string; phone: string | null; memo: string | null; tags: string[]; manager_membership_id: string | null; created_at: string; updated_at: string }) => {
      const stats = visitStatsMap.get(c.id)
      return {
        ...c,
        visit_count: stats?.visit_count ?? 0,
        total_amount: stats?.total_amount ?? 0,
        last_visit: stats?.last_visit ?? null,
      }
    })

    return NextResponse.json({ customers: enriched })
  } catch (error) {
    if (error instanceof AuthError) {
      const status = error.type === "AUTH_MISSING" || error.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    console.error("[customers GET] unexpected:", error)
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    if (!["owner", "manager"].includes(authContext.role)) {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }

    let body: { name?: string; phone?: string; memo?: string; tags?: string[] }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    }

    const { name, phone, memo, tags } = body
    if (!name || name.trim().length === 0) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "name is required." }, { status: 400 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const normalizedPhone = phone ? phone.replace(/\D/g, "") : null

    // Check for duplicate phone in same store (CUSTOMER-7)
    let duplicates: { id: string; name: string; phone: string | null }[] = []
    if (normalizedPhone) {
      const { data: existing } = await supabase
        .from("customers")
        .select("id, name, phone")
        .eq("store_uuid", authContext.store_uuid)
        .eq("phone", normalizedPhone)
        .limit(5)

      if (existing && existing.length > 0) {
        duplicates = existing
      }
    }

    const { data: customer, error: insertError } = await supabase
      .from("customers")
      .insert({
        store_uuid: authContext.store_uuid,
        name: name.trim(),
        phone: normalizedPhone || null,
        memo: memo?.trim() || null,
        tags: tags ?? [],
        manager_membership_id: authContext.role === "manager" ? authContext.membership_id : null,
      })
      .select("id, name, phone, memo, tags, created_at")
      .single()

    if (insertError || !customer) {
      console.error("[customers POST] insert failed:", insertError?.message, insertError?.details)
      return NextResponse.json({ error: "CREATE_FAILED", message: insertError?.message ?? "손님 등록에 실패했습니다." }, { status: 500 })
    }

    // Audit
    await supabase.from("audit_events").insert({
      store_uuid: authContext.store_uuid,
      actor_profile_id: authContext.user_id,
      actor_membership_id: authContext.membership_id,
      actor_role: authContext.role,
      actor_type: authContext.role,
      entity_table: "customers",
      entity_id: customer.id,
      action: "customer_created",
      after: { name: name.trim(), phone: normalizedPhone, tags: tags ?? [] },
    })

    return NextResponse.json({ ...customer, duplicates }, { status: 201 })
  } catch (error) {
    if (error instanceof AuthError) {
      const status = error.type === "AUTH_MISSING" || error.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    console.error("[customers POST] unexpected:", error)
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
