#!/usr/bin/env node
/**
 * orphan auth.users 정리 스크립트.
 *
 * 정의 (orphan):
 *   - auth.users 에는 있지만
 *   - profiles 또는 store_memberships(approved, not deleted) 가 없음
 *
 * 안전 정책:
 *   1. DRY-RUN 기본값 — 실제 삭제 안 함. --execute 플래그 필수.
 *   2. 일정 기간 (--older-than-days, 기본 14일) 보다 오래된 row 만 대상.
 *      최근 가입 실패는 자연 retry 가능성 있어 보존.
 *   3. 매 row 작업 마다 system_errors 에 audit row 기록 ("orphan_user_cleanup").
 *   4. 실패한 row 는 skip + 로그. 다음 실행에서 재시도 가능.
 *
 * 사용:
 *   node scripts/cleanup-orphan-users.mjs                           # dry-run
 *   node scripts/cleanup-orphan-users.mjs --older-than-days=30      # 30일 이상
 *   node scripts/cleanup-orphan-users.mjs --execute                 # 실 삭제
 *   node scripts/cleanup-orphan-users.mjs --execute --batch=50      # 배치 단위
 *
 * 환경변수:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * 위험:
 *   auth.admin.deleteUser() 는 비가역. 실행 전 dry-run 출력 반드시 검토.
 */

import { createClient } from "@supabase/supabase-js"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error("[cleanup-orphan-users] env 필수: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}

const args = process.argv.slice(2)
const flags = Object.fromEntries(
  args.map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=")
    return [k, v ?? "true"]
  }),
)

const EXECUTE = flags.execute === "true"
const OLDER_THAN_DAYS = parseInt(flags["older-than-days"] ?? "14", 10)
const BATCH = parseInt(flags.batch ?? "50", 10)

const admin = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
})

console.log(`[cleanup-orphan-users] mode=${EXECUTE ? "EXECUTE" : "DRY-RUN"}`)
console.log(`  cutoff: created_at < NOW() - ${OLDER_THAN_DAYS} days`)
console.log(`  batch:  ${BATCH}`)
console.log("")

async function fetchOrphanUsers() {
  // auth.admin.listUsers 는 페이지네이션. profile 부재 검증은 별도 쿼리.
  let page = 1
  const allOrphans = []
  // listUsers 의 perPage 기본 50, 최대 1000.
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw new Error(`listUsers failed: ${error.message}`)
    if (!data?.users || data.users.length === 0) break

    const cutoff = new Date(Date.now() - OLDER_THAN_DAYS * 24 * 60 * 60 * 1000)
    const candidates = data.users.filter((u) => new Date(u.created_at) < cutoff)

    if (candidates.length > 0) {
      const ids = candidates.map((u) => u.id)
      // profile 존재 여부 일괄 조회
      const { data: profiles } = await admin
        .from("profiles")
        .select("id")
        .in("id", ids)
      const hasProfile = new Set((profiles ?? []).map((p) => p.id))

      // membership 존재 여부 일괄 조회
      const { data: memberships } = await admin
        .from("store_memberships")
        .select("profile_id")
        .in("profile_id", ids)
        .is("deleted_at", null)
      const hasMembership = new Set((memberships ?? []).map((m) => m.profile_id))

      for (const u of candidates) {
        if (!hasProfile.has(u.id) && !hasMembership.has(u.id)) {
          allOrphans.push({
            id: u.id,
            email: u.email ?? null,
            created_at: u.created_at,
          })
        }
      }
    }

    if (data.users.length < 1000) break
    page++
  }
  return allOrphans
}

async function logCleanup(userId, email, status, error) {
  try {
    await admin.from("system_errors").insert({
      tag: "orphan_user_cleanup",
      error_name: status === "deleted" ? "INFO" : "ERROR",
      error_message: `orphan auth.user ${status}: ${email ?? userId.slice(0, 8)}${error ? ` — ${error}` : ""}`,
      extra: { user_id: userId, email, status, error: error ?? null },
    })
  } catch { /* logging failure 는 무시 */ }
}

async function main() {
  const orphans = await fetchOrphanUsers()
  console.log(`[cleanup-orphan-users] found ${orphans.length} orphan users older than ${OLDER_THAN_DAYS} days`)
  if (orphans.length === 0) {
    console.log("  none to clean.")
    return
  }
  console.log("")
  console.log("Sample (first 10):")
  for (const o of orphans.slice(0, 10)) {
    console.log(`  ${o.id}  ${o.email ?? "(no email)"}  created_at=${o.created_at}`)
  }
  if (orphans.length > 10) console.log(`  ... and ${orphans.length - 10} more`)
  console.log("")

  if (!EXECUTE) {
    console.log("[DRY-RUN] no deletion. Re-run with --execute to delete.")
    return
  }

  let deleted = 0
  let failed = 0
  for (let i = 0; i < orphans.length; i += BATCH) {
    const batch = orphans.slice(i, i + BATCH)
    for (const o of batch) {
      try {
        const { error } = await admin.auth.admin.deleteUser(o.id)
        if (error) {
          failed++
          await logCleanup(o.id, o.email, "delete_failed", error.message)
          console.error(`  ✗ ${o.id} (${o.email}) — ${error.message}`)
        } else {
          deleted++
          await logCleanup(o.id, o.email, "deleted", null)
          if (deleted % 25 === 0) console.log(`  ... ${deleted} deleted`)
        }
      } catch (e) {
        failed++
        await logCleanup(o.id, o.email, "delete_failed", e.message)
        console.error(`  ✗ ${o.id} — ${e.message}`)
      }
    }
  }
  console.log("")
  console.log(`[cleanup-orphan-users] done — deleted ${deleted}, failed ${failed}`)
}

main().catch((e) => {
  console.error("[cleanup-orphan-users] fatal:", e)
  process.exit(1)
})
