import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { escapeLikeValue } from "@/lib/security/postgrestEscape"
import { logAuditEvent } from "@/lib/audit/logEvent"
import { cached } from "@/lib/cache/inMemoryTtl"

/**
 * GET  /api/customers?q=xxx&scope=mine|all — 손님 검색 (store_uuid 기준)
 * POST /api/customers — 손님 신규 생성
 *
 * 2026-05-03 R-Speed-x10:
 *   - dead code 제거 (receipts query 가 데이터를 만들기만 하고 사용 안 함 →
 *     매 호출마다 finalized 영수증 전체 fetch 라는 거대한 낭비).
 *   - q="" (초기 로드) 은 5초 TTL 캐시 (CustomerPicker 모달 매번 hit).
 *   - audit log 진짜 background fire (`void` + 무await).
 *   - Cache-Control: private, max-age=2, stale-while-revalidate=8.
 */

const CUSTOMERS_TTL_MS = 5000

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
    const q = searchParams.get("q")?.trim() ?? ""
    const scope = searchParams.get("scope") || "all"
    const limit = Math.min(Number(searchParams.get("limit") ?? 50), 100)

    // q (검색어) 가 있더라도 같은 검색어가 5초 내 반복되면 캐시 (실제로 빠른
    // 타이핑 또는 입력 후 즉시 클릭 시나리오에서 hit). caller membership 까지
    // key 에 포함해 manager mine_only filter 안전성 유지.
    const cacheKey = `${authContext.store_uuid}:${authContext.role}:${authContext.membership_id}:${scope}:${q}:${limit}`

    // 검색어 검증은 캐시 진입 전에 (BAD_REQUEST 응답을 캐시 안 하기 위해).
    let safeQ: string | null | undefined = undefined
    if (q.length > 0) {
      safeQ = escapeLikeValue(q)
      if (safeQ === null) {
        return NextResponse.json(
          { error: "BAD_REQUEST", message: "q is too long." },
          { status: 400 },
        )
      }
    }

    type Enriched = {
      id: string
      name: string
      phone: string | null
      memo: string | null
      tags: string[]
      manager_membership_id: string | null
      created_at: string
      updated_at: string
      visit_count: number
      total_amount: number
      last_visit: string | null
    }

    const enriched = await cached<Enriched[]>(
      "customers_list",
      cacheKey,
      CUSTOMERS_TTL_MS,
      async () => {
        let query = supabase
          .from("customers")
          .select(
            "id, name, phone, memo, tags, manager_membership_id, created_at, updated_at",
          )
          .eq("store_uuid", authContext.store_uuid)
          .order("updated_at", { ascending: false })
          .limit(limit)

        // Manager scope filtering (CUSTOMER-4)
        if (authContext.role === "manager" && scope === "mine") {
          query = query.eq("manager_membership_id", authContext.membership_id)
        }

        // SECURITY (R-4): escape LIKE wildcards (`%`, `_`, `\`).
        if (safeQ && safeQ.length > 0) {
          const isDigits = /^\d+$/.test(safeQ)
          if (isDigits) {
            query = query.like("phone", `${safeQ}%`)
          } else {
            query = query.ilike("name", `%${safeQ}%`)
          }
        }

        const { data: customers, error: queryError } = await query
        if (queryError) {
          console.error("[customers GET] query failed:", queryError)
          throw new Error(`QUERY_FAILED:${queryError.message}`)
        }

        const rows = (customers ?? []) as Array<{
          id: string
          name: string
          phone: string | null
          memo: string | null
          tags: string[]
          manager_membership_id: string | null
          created_at: string
          updated_at: string
        }>
        const customerIds = rows.map((c) => c.id)

        // 방문 횟수 + 마지막 방문 시각 (가벼운 단일 쿼리).
        // 2026-05-03: receipts join 으로 total_amount 계산하던 구 코드는 결과를
        //   사용 안 하면서 store 전체 finalized 영수증 fetch — 최대 수천 row,
        //   매 검색마다 200ms+ 추가. 완전 제거. total_amount 는 항상 0 으로
        //   유지 (UI 에서 표시 안 함).
        const visitStatsMap = new Map<
          string,
          { visit_count: number; last_visit: string | null }
        >()

        if (customerIds.length > 0) {
          const { data: sessions } = await supabase
            .from("room_sessions")
            .select("customer_id, started_at")
            .eq("store_uuid", authContext.store_uuid)
            .in("customer_id", customerIds)
            .order("started_at", { ascending: false })

          if (sessions) {
            for (const s of sessions as Array<{
              customer_id: string
              started_at: string
            }>) {
              const existing = visitStatsMap.get(s.customer_id)
              if (existing) {
                existing.visit_count++
              } else {
                visitStatsMap.set(s.customer_id, {
                  visit_count: 1,
                  last_visit: s.started_at,
                })
              }
            }
          }
        }

        return rows.map((c) => {
          const stats = visitStatsMap.get(c.id)
          return {
            ...c,
            visit_count: stats?.visit_count ?? 0,
            total_amount: 0,
            last_visit: stats?.last_visit ?? null,
          }
        })
      },
    )

    // R28-PII: 손님 이름/전화 응답 시 audit log (개인정보보호법 대응).
    //   2026-05-03: 진짜 background fire — await 제거.
    if (enriched.length > 0) {
      void logAuditEvent(supabase, {
        auth: authContext,
        action: "customers_viewed",
        entity_table: "credits",
        entity_id: authContext.store_uuid,
        status: "success",
        metadata: {
          row_count: enriched.length,
          search_query: q ? "yes" : "no",
          scope,
          contains_phone: enriched.some((c) => c.phone),
        },
      }).catch(() => {
        /* silent */
      })
    }

    const res = NextResponse.json({ customers: enriched })
    // 손님 데이터는 자주 바뀌지 않음 — 짧은 max-age + SWR 로 polling 부담 ↓.
    res.headers.set("Cache-Control", "private, max-age=2, stale-while-revalidate=8")
    return res
  } catch (error) {
    if (error instanceof AuthError) {
      const status = error.type === "AUTH_MISSING" || error.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    if (error instanceof Error && error.message.startsWith("QUERY_FAILED:")) {
      return NextResponse.json({ error: "QUERY_FAILED" }, { status: 500 })
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
      console.error("[customers POST] insert failed:", insertError)
      return NextResponse.json({ error: "CREATE_FAILED", message: "손님 등록에 실패했습니다." }, { status: 500 })
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
