import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getMeAccounts } from "@/lib/server/queries/me/accounts"
import { getMePayees } from "@/lib/server/queries/me/payees"
import { cached } from "@/lib/cache/inMemoryTtl"

// 2026-05-03 R-Speed-x10: hostess /me 페이지 mount 시 호출. accounts/payees
//   거의 안 바뀜 (월 1~2회 owner 가 등록). 30s TTL 안전.
const ME_BOOTSTRAP_TTL_MS = 30_000

async function slot<T>(
  routeTag: string,
  slotName: string,
  fn: () => Promise<T>,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const t0 = Date.now()
  try {
    const data = await fn()
    const ms = Date.now() - t0
    console.log(JSON.stringify({ tag: "perf.bootstrap.slot", route: routeTag, slot: slotName, ok: true, ms }))
    return { ok: true, data }
  } catch (e) {
    const ms = Date.now() - t0
    const error = e instanceof Error ? e.message : "err"
    console.log(JSON.stringify({ tag: "perf.bootstrap.slot", route: routeTag, slot: slotName, ok: false, error, ms }))
    return { ok: false, error }
  }
}

export async function GET(request: Request) {
  let auth
  try {
    auth = await resolveAuthContext(request)
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "auth failure" }, { status: 500 })
  }

  const tStart = Date.now()

  // /api/auth/me just reflects AuthContext — build inline, no DB call.
  const profileData = {
    user_id: auth.user_id,
    membership_id: auth.membership_id,
    store_uuid: auth.store_uuid,
    role: auth.role,
    membership_status: auth.membership_status,
    is_super_admin: auth.is_super_admin,
  }

  type MeBootstrapPayload = {
    accounts: unknown
    payees: unknown
    errors: { accounts: string | null; payees: string | null }
  }

  const cacheKey = `${auth.user_id}:${auth.store_uuid}:${auth.membership_id}`
  const data = await cached<MeBootstrapPayload>(
    "me_bootstrap",
    cacheKey,
    ME_BOOTSTRAP_TTL_MS,
    async () => {
      const [accountsR, payeesR] = await Promise.all([
        slot("me", "accounts", () => getMeAccounts(auth)),
        slot("me", "payees", () => getMePayees(auth)),
      ])
      console.log(
        JSON.stringify({
          tag: "perf.bootstrap.total",
          route: "me",
          ms: Date.now() - tStart,
        }),
      )
      return {
        accounts: accountsR.ok ? (accountsR.data.accounts ?? []) : null,
        payees: payeesR.ok ? (payeesR.data.payees ?? []) : null,
        errors: {
          accounts: accountsR.ok ? null : accountsR.error,
          payees: payeesR.ok ? null : payeesR.error,
        },
      }
    },
  )

  const res = NextResponse.json({
    profile: profileData,
    accounts: data.accounts,
    payees: data.payees,
    errors: {
      profile: null,
      accounts: data.errors.accounts,
      payees: data.errors.payees,
    },
    generated_at: new Date().toISOString(),
  })
  res.headers.set(
    "Cache-Control",
    "private, max-age=10, stale-while-revalidate=60",
  )
  return res
}
