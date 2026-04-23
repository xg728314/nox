/**
 * verify-rooms-authed.ts — RLS-phase-5: rooms pilot E2E verification.
 *
 * 실행:
 *   npx tsx scripts/rls/verify-rooms-authed.ts
 *
 * 필수 환경변수 (env 또는 .env.local 에서 자동 로드):
 *   NEXT_PUBLIC_SUPABASE_URL          Supabase project URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY     anon / publishable key
 *   RLS_TEST_EMAIL                    테스트 계정 이메일 (authenticated)
 *   RLS_TEST_PASSWORD                 테스트 계정 비밀번호
 *
 * 선택 환경변수:
 *   RLS_TEST_OTHER_STORE_UUID         cross-store 차단 검증에 쓸 "다른 매장" UUID.
 *                                     미설정 시 해당 테스트는 SKIP.
 *
 * 이 스크립트는:
 *   - app 코드 / route / migration 을 수정하지 않는다.
 *   - 네트워크를 통해 Supabase 에 로그인하고 rooms 테이블을 조회한다.
 *   - JWT 의 app_metadata.store_uuid / is_super_admin 을 디코드해서 출력한다.
 *   - 각 검증 결과를 PASS / FAIL / SKIP 으로 출력한다.
 *   - 모든 PASS 가 아니면 exit code 1 (FAIL) 로 종료.
 *
 * service role 경로 검증은 이 스크립트에서 하지 않는다 (아래 Report 섹션 참조).
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import * as fs from "node:fs"
import * as path from "node:path"

type EnvBundle = {
  url: string
  anonKey: string
  email: string
  password: string
  otherStoreUuid: string | null
}

type JwtPayload = {
  sub?: string
  email?: string
  aud?: string
  role?: string
  app_metadata?: {
    store_uuid?: string | null
    is_super_admin?: boolean
    [k: string]: unknown
  }
  user_metadata?: Record<string, unknown>
  [k: string]: unknown
}

type Outcome = "PASS" | "FAIL" | "SKIP"
type TestResult = { name: string; outcome: Outcome; detail?: string }

// ── .env.local parser (최소 구현, dotenv 의존 없음) ─────────────
function loadDotEnvLocal(): void {
  const cwd = process.cwd()
  const candidates = [
    path.join(cwd, ".env.local"),
    path.join(cwd, ".env"),
  ]
  for (const filepath of candidates) {
    if (!fs.existsSync(filepath)) continue
    const content = fs.readFileSync(filepath, "utf8")
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line || line.startsWith("#")) continue
      const eq = line.indexOf("=")
      if (eq < 0) continue
      const key = line.slice(0, eq).trim()
      let value = line.slice(eq + 1).trim()
      // strip surrounding quotes
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      if (process.env[key] === undefined) {
        process.env[key] = value
      }
    }
  }
}

function getEnv(): { ok: true; env: EnvBundle } | { ok: false; missing: string[] } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""
  const email = process.env.RLS_TEST_EMAIL ?? ""
  const password = process.env.RLS_TEST_PASSWORD ?? ""
  const otherStoreRaw = process.env.RLS_TEST_OTHER_STORE_UUID ?? ""
  const otherStoreUuid = otherStoreRaw.length > 0 ? otherStoreRaw : null
  const missing: string[] = []
  if (!url) missing.push("NEXT_PUBLIC_SUPABASE_URL")
  if (!anonKey) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY")
  if (!email) missing.push("RLS_TEST_EMAIL")
  if (!password) missing.push("RLS_TEST_PASSWORD")
  if (missing.length > 0) return { ok: false, missing }
  return { ok: true, env: { url, anonKey, email, password, otherStoreUuid } }
}

// ── base64url JWT payload decoder ──────────────────────────────
function decodeJwt(token: string): JwtPayload | null {
  const parts = token.split(".")
  if (parts.length !== 3) return null
  try {
    const payload = parts[1]
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/")
    const pad = base64.length % 4
    const padded = pad === 0 ? base64 : base64 + "=".repeat(4 - pad)
    const json = Buffer.from(padded, "base64").toString("utf8")
    return JSON.parse(json) as JwtPayload
  } catch {
    return null
  }
}

function line(prefix: string, r: TestResult): string {
  const pad = r.name.padEnd(58, " ")
  const detail = r.detail ? `  ${r.detail}` : ""
  return `${prefix} ${pad}${r.outcome}${detail}`
}

async function main(): Promise<void> {
  loadDotEnvLocal()

  const results: TestResult[] = []

  // ── [1] env loaded ──────────────────────────────────────────
  const envCheck = getEnv()
  if (!envCheck.ok) {
    results.push({
      name: "env loaded",
      outcome: "FAIL",
      detail: `missing: ${envCheck.missing.join(", ")}`,
    })
    printReport(results)
    process.exit(1)
    return
  }
  const env = envCheck.env
  results.push({
    name: "env loaded",
    outcome: "PASS",
    detail: `url=${env.url}`,
  })

  // ── [2] signInWithPassword ─────────────────────────────────
  const anon: SupabaseClient = createClient(env.url, env.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const signInRes = await anon.auth.signInWithPassword({
    email: env.email,
    password: env.password,
  })
  const session = signInRes.data?.session
  const accessToken = session?.access_token ?? ""
  if (signInRes.error || !accessToken) {
    results.push({
      name: "signInWithPassword",
      outcome: "FAIL",
      detail: signInRes.error?.message ?? "no access_token",
    })
    printReport(results)
    process.exit(1)
    return
  }
  const userId = session?.user?.id ?? "?"
  results.push({
    name: "signInWithPassword",
    outcome: "PASS",
    detail: `user=${userId}`,
  })

  // ── [3] JWT app_metadata.store_uuid present ────────────────
  const payload = decodeJwt(accessToken)
  if (!payload) {
    results.push({ name: "JWT decode", outcome: "FAIL", detail: "malformed JWT" })
    printReport(results)
    process.exit(1)
    return
  }
  const storeUuid = payload.app_metadata?.store_uuid ?? null
  const isSuperAdmin = payload.app_metadata?.is_super_admin === true
  if (!storeUuid) {
    results.push({
      name: "JWT app_metadata.store_uuid present",
      outcome: "FAIL",
      detail:
        "app_metadata.store_uuid missing — hook inactive or user has no primary membership",
    })
  } else {
    results.push({
      name: "JWT app_metadata.store_uuid present",
      outcome: "PASS",
      detail: `store_uuid=${storeUuid}`,
    })
  }
  results.push({
    name: "JWT app_metadata.is_super_admin present",
    outcome: payload.app_metadata !== undefined ? "PASS" : "FAIL",
    detail: `value=${isSuperAdmin}`,
  })

  // authed client: apikey=anon, Authorization=Bearer <access_token>
  const authed: SupabaseClient = createClient(env.url, env.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  })

  // ── [4..9] authed SELECT per table: same-store / cross-store ─
  //   rooms (068), hostesses (069), store_memberships (069)
  //   동일한 JWT-claim policy 구조 → 동일 기대치.
  const tables: Array<{ name: string; col: string }> = [
    { name: "rooms", col: "store_uuid" },
    { name: "hostesses", col: "store_uuid" },
    { name: "store_memberships", col: "store_uuid" },
  ]
  for (const t of tables) {
    // same-store read
    if (!storeUuid) {
      results.push({
        name: `authed ${t.name} SELECT (same-store)`,
        outcome: "SKIP",
        detail: "no store_uuid claim",
      })
    } else {
      const sameRes = await authed
        .from(t.name)
        .select(`id, ${t.col}`, { count: "exact" })
        .eq(t.col, storeUuid)
        .limit(200)
      if (sameRes.error) {
        results.push({
          name: `authed ${t.name} SELECT (same-store)`,
          outcome: "FAIL",
          detail: `error: ${sameRes.error.message}`,
        })
      } else {
        const n = sameRes.data?.length ?? 0
        if (n > 0) {
          results.push({
            name: `authed ${t.name} SELECT (same-store)`,
            outcome: "PASS",
            detail: `rows=${n}`,
          })
        } else {
          results.push({
            name: `authed ${t.name} SELECT (same-store)`,
            outcome: "FAIL",
            detail:
              "rows=0 — RLS may be blocking OR no seed rows for this store (ambiguous).",
          })
        }
      }
    }

    // cross-store blocked
    if (!env.otherStoreUuid) {
      results.push({
        name: `authed ${t.name} SELECT (other store blocked)`,
        outcome: "SKIP",
        detail: "RLS_TEST_OTHER_STORE_UUID not set",
      })
    } else if (env.otherStoreUuid === storeUuid) {
      results.push({
        name: `authed ${t.name} SELECT (other store blocked)`,
        outcome: "SKIP",
        detail: "RLS_TEST_OTHER_STORE_UUID equals user's own store",
      })
    } else {
      const otherRes = await authed
        .from(t.name)
        .select(`id, ${t.col}`, { count: "exact" })
        .eq(t.col, env.otherStoreUuid)
        .limit(200)
      if (otherRes.error) {
        results.push({
          name: `authed ${t.name} SELECT (other store blocked)`,
          outcome: "FAIL",
          detail: `error: ${otherRes.error.message}`,
        })
      } else {
        const n = otherRes.data?.length ?? 0
        if (n === 0) {
          results.push({
            name: `authed ${t.name} SELECT (other store blocked)`,
            outcome: "PASS",
            detail: `rows=0 (expected: RLS blocks cross-store read)`,
          })
        } else if (isSuperAdmin) {
          results.push({
            name: `authed ${t.name} SELECT (other store blocked)`,
            outcome: "PASS",
            detail: `rows=${n} (super_admin bypass policy active)`,
          })
        } else {
          results.push({
            name: `authed ${t.name} SELECT (other store blocked)`,
            outcome: "FAIL",
            detail: `rows=${n} — RLS did NOT block cross-store read. Policy leak.`,
          })
        }
      }
    }
  }

  printReport(results)
  const anyFail = results.some((r) => r.outcome === "FAIL")
  process.exit(anyFail ? 1 : 0)
}

function printReport(results: TestResult[]): void {
  // eslint-disable-next-line no-console
  console.log("=========================================================")
  // eslint-disable-next-line no-console
  console.log("  NOX RLS-phase-5 rooms pilot — authed E2E verification")
  // eslint-disable-next-line no-console
  console.log("=========================================================")
  for (let i = 0; i < results.length; i++) {
    const prefix = `[${i + 1}/${results.length}]`
    // eslint-disable-next-line no-console
    console.log(line(prefix, results[i]))
  }
  const passCount = results.filter((r) => r.outcome === "PASS").length
  const failCount = results.filter((r) => r.outcome === "FAIL").length
  const skipCount = results.filter((r) => r.outcome === "SKIP").length
  // eslint-disable-next-line no-console
  console.log("---------------------------------------------------------")
  // eslint-disable-next-line no-console
  console.log(
    `  SUMMARY: ${failCount === 0 ? "PASS" : "FAIL"}   pass=${passCount} fail=${failCount} skip=${skipCount}`,
  )
  // eslint-disable-next-line no-console
  console.log("=========================================================")

  // service role 경로 설명 (실측 대신 고정 안내)
  // eslint-disable-next-line no-console
  console.log(
    [
      "",
      "Note — service role path:",
      "  본 스크립트는 anon key + authed JWT 만 사용. 기존 NOX API route",
      "  들은 SUPABASE_SERVICE_ROLE_KEY 로 Supabase client 를 만들며,",
      "  service_role 역할은 BYPASSRLS 속성을 갖는다. 따라서 rooms 에",
      "  064 / 068 policy 가 적용되어도 service role 쿼리는 전 row 반환",
      "  그대로 유지된다 (기존 API 무영향). 검증이 필요하면 운영자는",
      "  동일한 매장의 rooms 건수를 기존 /api/rooms route 의 응답과",
      "  Supabase SQL Editor(postgres superuser) 의 `SELECT count(*) FROM",
      "  rooms WHERE store_uuid = '<id>'` 결과로 직접 대조하라.",
      "",
    ].join("\n"),
  )
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[verify-rooms-authed] fatal:", err instanceof Error ? err.message : err)
  process.exit(2)
})
