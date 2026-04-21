import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { escapeLikeValue } from "@/lib/security/postgrestEscape"

/**
 * STEP-015: GET /api/stores
 *
 * Read-only list of stores for picker UX (cross-store target selection
 * primarily). Owner-only — manager/hostess do not need the full store
 * directory. By default the caller's own store is excluded so the
 * picker cannot accidentally produce a SAME_STORE cross-store.
 *
 * Query:
 *   ?include_self=1  — override (default excludes caller's store)
 *   ?q=foo           — optional case-insensitive name filter
 */

function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key)
}

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner") {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 })
    }

    const url = new URL(request.url)
    const includeSelf = url.searchParams.get("include_self") === "1"
    const qRaw = url.searchParams.get("q") ?? ""
    const q = qRaw.trim().slice(0, 80)

    const supabase = supa()
    let query = supabase
      .from("stores")
      .select("id, store_name, store_code, floor")
      .is("deleted_at", null)
      .order("store_name", { ascending: true })
      .limit(200)

    if (!includeSelf) {
      query = query.neq("id", auth.store_uuid)
    }
    if (q.length > 0) {
      // SECURITY (R-4): escape `%` / `_` / `\` so a user-supplied `%`
      // is matched literally, not as "match everything". Without this
      // a request of `?q=%` returns every store.
      const safeQ = escapeLikeValue(q)
      if (safeQ === null) {
        return NextResponse.json(
          { error: "BAD_REQUEST", message: "q is too long." },
          { status: 400 },
        )
      }
      if (safeQ.length > 0) {
        query = query.ilike("store_name", `%${safeQ}%`)
      }
    }

    const { data } = await query
    return NextResponse.json({ stores: data ?? [] })
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
