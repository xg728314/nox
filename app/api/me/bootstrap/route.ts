import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"

type ForwardResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string }

async function forwardJson<T>(origin: string, path: string, cookie: string): Promise<ForwardResult<T>> {
  try {
    const r = await fetch(`${origin}${path}`, {
      method: "GET",
      headers: cookie ? { cookie } : {},
      cache: "no-store",
    })
    if (!r.ok) return { ok: false, status: r.status, error: `HTTP_${r.status}` }
    return { ok: true, data: (await r.json()) as T }
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : "network" }
  }
}

export async function GET(request: Request) {
  try {
    await resolveAuthContext(request)
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "auth failure" }, { status: 500 })
  }

  const cookie = request.headers.get("cookie") ?? ""
  const origin = new URL(request.url).origin

  const [profileR, accountsR, payeesR] = await Promise.all([
    forwardJson<Record<string, unknown>>(origin, "/api/auth/me", cookie),
    forwardJson<{ accounts?: unknown[] }>(origin, "/api/me/accounts", cookie),
    forwardJson<{ payees?: unknown[] }>(origin, "/api/me/payees", cookie),
  ])

  return NextResponse.json({
    profile: profileR.ok ? profileR.data : null,
    accounts: accountsR.ok ? (accountsR.data.accounts ?? []) : null,
    payees: payeesR.ok ? (payeesR.data.payees ?? []) : null,
    errors: {
      profile: profileR.ok ? null : profileR.error,
      accounts: accountsR.ok ? null : accountsR.error,
      payees: payeesR.ok ? null : payeesR.error,
    },
    generated_at: new Date().toISOString(),
  })
}
