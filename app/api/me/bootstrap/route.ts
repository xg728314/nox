import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getMeAccounts } from "@/lib/server/queries/meAccounts"
import { getMePayees } from "@/lib/server/queries/mePayees"

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

  const [accountsR, payeesR] = await Promise.all([
    slot("me", "accounts", () => getMeAccounts(auth)),
    slot("me", "payees", () => getMePayees(auth)),
  ])
  console.log(JSON.stringify({ tag: "perf.bootstrap.total", route: "me", ms: Date.now() - tStart }))

  return NextResponse.json({
    profile: profileData,
    accounts: accountsR.ok ? (accountsR.data.accounts ?? []) : null,
    payees: payeesR.ok ? (payeesR.data.payees ?? []) : null,
    errors: {
      profile: null,
      accounts: accountsR.ok ? null : accountsR.error,
      payees: payeesR.ok ? null : payeesR.error,
    },
    generated_at: new Date().toISOString(),
  })
}
