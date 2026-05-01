import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"

/**
 * GET /api/learn/stats
 *
 * R-Learn-Corpus (2026-04-30): 학습 corpus 현황 — /admin/learn dashboard 용.
 *
 * 가드: super_admin only (export 와 동일 정책).
 *
 * Query:
 *   - target_store_uuid: 특정 매장만 (생략 시 전 매장 합산)
 *
 * 응답:
 *   {
 *     total: number,                                  // 활성 row 총 개수
 *     by_type: [{ signal_type, count }, ...],         // type 별 분포 (count desc)
 *     by_store: [{ store_uuid, store_name, count }],  // 매장별 분포
 *     recent: [{ ...row, store_name }],               // 최근 20건 (PII row 는 hash)
 *   }
 *
 * Note: signal_type 별 count 는 SQL aggregate 가 RLS 우회 service-role 로
 *       실행됨. PostgREST 가 group by 직접 안 받으므로 raw 가져와서 코드로
 *       count. 5000 row 까지만 fetch (limit) — corpus 작을 때 충분.
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key)
}

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (!auth.is_super_admin) {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Super admin access required." },
        { status: 403 },
      )
    }

    const url = new URL(request.url)
    const targetStoreParam = url.searchParams.get("target_store_uuid")

    // 2026-05-01 R-Learn-Scope-Fix: 매장별 분리 default.
    //   사용자 보고: "신세계로 들어왔는데 마블 학습 데이터가 보인다."
    //   원인: target_store_uuid 미명시 시 전 매장 fetch (super_admin 통과).
    //   수정:
    //     - 명시 X → auth.store_uuid (현재 active store) 로 default.
    //     - "all" 명시 → 전 매장 (super_admin 의도적 전체 view).
    //     - 다른 store_uuid 명시 → 그 매장만 (super_admin override).
    //   학습 prompt 주입은 어차피 매장별 분리되어 있어서 정확도 영향 X.
    //   본 수정은 super_admin dashboard view 의 분리만 강제.
    const targetStore: string | null = targetStoreParam === "all"
      ? null
      : (targetStoreParam || auth.store_uuid)

    const supabase = supa()

    // 전체 row 가져와서 코드 aggregate. corpus 가 5000 넘으면 PG aggregate
    // RPC 로 변경 필요 — 그 시점엔 별도 라운드.
    let q = supabase
      .from("learning_signals")
      .select("id, store_uuid, signal_type, raw_value, corrected_value, pii_masked, source_model, created_at")
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(5000)

    if (targetStore) q = q.eq("store_uuid", targetStore)

    const { data, error } = await q
    if (error) {
      return NextResponse.json({ error: "DB_ERROR", message: error.message }, { status: 500 })
    }
    const rows = (data ?? []) as Array<{
      id: string
      store_uuid: string | null
      signal_type: string
      raw_value: string | null
      corrected_value: string | null
      pii_masked: boolean
      source_model: string | null
      created_at: string
    }>

    // store name lookup
    const storeIds = Array.from(new Set(rows.map((r) => r.store_uuid).filter((x): x is string => !!x)))
    const storeNameMap = new Map<string, string>()
    if (storeIds.length > 0) {
      const { data: storeRows } = await supabase
        .from("stores")
        .select("id, name")
        .in("id", storeIds)
      for (const s of (storeRows ?? []) as Array<{ id: string; name: string }>) {
        storeNameMap.set(s.id, s.name)
      }
    }

    // by_type aggregate
    const typeCount = new Map<string, number>()
    for (const r of rows) {
      typeCount.set(r.signal_type, (typeCount.get(r.signal_type) ?? 0) + 1)
    }
    const by_type = Array.from(typeCount.entries())
      .map(([signal_type, count]) => ({ signal_type, count }))
      .sort((a, b) => b.count - a.count)

    // by_store aggregate
    const storeCount = new Map<string, number>()
    for (const r of rows) {
      const k = r.store_uuid ?? "(none)"
      storeCount.set(k, (storeCount.get(k) ?? 0) + 1)
    }
    const by_store = Array.from(storeCount.entries())
      .map(([store_uuid, count]) => ({
        store_uuid: store_uuid === "(none)" ? null : store_uuid,
        store_name: store_uuid === "(none)" ? null : storeNameMap.get(store_uuid) ?? null,
        count,
      }))
      .sort((a, b) => b.count - a.count)

    // recent 20
    const recent = rows.slice(0, 20).map((r) => ({
      ...r,
      store_name: r.store_uuid ? storeNameMap.get(r.store_uuid) ?? null : null,
    }))

    // 2026-05-01: scope 정보를 응답에 포함 — UI 가 "어느 매장 데이터인지" 명확히 표시.
    const scope: { kind: "single" | "all"; store_uuid: string | null; store_name: string | null } =
      targetStore === null
        ? { kind: "all", store_uuid: null, store_name: null }
        : {
            kind: "single",
            store_uuid: targetStore,
            store_name: storeNameMap.get(targetStore) ?? null,
          }

    return NextResponse.json({
      scope,
      active_store_uuid: auth.store_uuid,
      total: rows.length,
      capped: rows.length === 5000,
      by_type,
      by_store,
      recent,
    })
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
