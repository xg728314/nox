import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { cached } from "@/lib/cache/inMemoryTtl"

// 2026-05-03 R-Speed-x10: 사용자의 멤버십은 거의 안 바뀜 (월 1~2회 추가).
//   페이지 mount / store switcher 마다 호출되므로 60초 TTL 적합.
//   key 는 token — 토큰 변경 (재로그인 / 재발급) 시 자동으로 다른 cache.
const MEMBERSHIPS_TTL_MS = 60_000

export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get("authorization")
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json({ error: "AUTH_MISSING" }, { status: 401 })
    }
    const token = authHeader.slice(7).trim()

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    type Payload = {
      user_id: string
      memberships: Array<{
        membership_id: string
        store_uuid: string
        store_name: string
        role: string
        is_primary: boolean
      }>
    }

    const payload = await cached<Payload>(
      "auth_memberships",
      token,
      MEMBERSHIPS_TTL_MS,
      async () => {
        const { data: userData, error: userError } =
          await supabase.auth.getUser(token)
        if (userError || !userData.user) {
          throw new Error("AUTH_INVALID")
        }

        // memberships query 후 store_name 조회는 의존이라 직렬 유지.
        const { data: memberships, error: memError } = await supabase
          .from("store_memberships")
          .select("id, store_uuid, role, status, is_primary")
          .eq("profile_id", userData.user.id)
          .eq("status", "approved")
          .is("deleted_at", null)
          .order("is_primary", { ascending: false })

        if (memError) {
          throw new Error("QUERY_FAILED")
        }

        type MembershipRow = {
          id: string
          store_uuid: string
          role: string
          is_primary: boolean
        }
        const memRows = (memberships ?? []) as MembershipRow[]
        const storeUuids = [...new Set(memRows.map((m) => m.store_uuid))]
        const storeMap = new Map<string, string>()
        if (storeUuids.length > 0) {
          const { data: stores } = await supabase
            .from("stores")
            .select("id, store_name")
            .in("id", storeUuids)

          for (const s of stores ?? []) {
            storeMap.set(s.id, s.store_name)
          }
        }

        return {
          user_id: userData.user.id,
          memberships: memRows.map((m) => ({
            membership_id: m.id,
            store_uuid: m.store_uuid,
            store_name: storeMap.get(m.store_uuid) || "",
            role: m.role,
            is_primary: m.is_primary,
          })),
        }
      },
    )

    const res = NextResponse.json(payload)
    res.headers.set(
      "Cache-Control",
      "private, max-age=30, stale-while-revalidate=300",
    )
    return res
  } catch (e) {
    if (e instanceof Error) {
      if (e.message === "AUTH_INVALID") {
        return NextResponse.json({ error: "AUTH_INVALID" }, { status: 401 })
      }
      if (e.message === "QUERY_FAILED") {
        return NextResponse.json({ error: "QUERY_FAILED" }, { status: 500 })
      }
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
