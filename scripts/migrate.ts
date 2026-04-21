/**
 * NOX DB 마이그레이션 스크립트
 * 003~009 순서 관리 + 적용 여부 체크
 *
 * 사용법:
 *   npx tsx scripts/migrate.ts          — 미적용 마이그레이션 실행
 *   npx tsx scripts/migrate.ts --status — 적용 현황만 조회
 *   npx tsx scripts/migrate.ts --dry    — 실행 없이 대상 목록만 표시
 */

import { createClient } from "@supabase/supabase-js"
import * as fs from "fs"
import * as path from "path"

const MIGRATIONS = [
  "000_migration_tracker.sql",
  "003_credits.sql",
  "004_payment.sql",
  "005_chat.sql",
  "006_pre_settlements.sql",
  "007_inventory.sql",
  "008_business_rules.sql",
  "009_cross_store_settlement.sql",
] as const

async function main() {
  const args = process.argv.slice(2)
  const statusOnly = args.includes("--status")
  const dryRun = args.includes("--dry")

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error("ERROR: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.")
    console.error("  Load from .env.local: npx dotenv -e .env.local -- npx tsx scripts/migrate.ts")
    process.exit(1)
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // 0. _migrations 테이블 확인/생성
  const trackerSql = fs.readFileSync(
    path.join(__dirname, "..", "database", "000_migration_tracker.sql"),
    "utf-8"
  )

  // rpc가 없을 수 있으므로 try로 감싸서 테이블 존재 확인
  let hasTracker = false
  try {
    const { error: checkErr } = await supabase.from("_migrations").select("id").limit(0)
    hasTracker = !checkErr
  } catch {
    hasTracker = false
  }

  if (!hasTracker) {
    console.log("⚠ _migrations 테이블이 없습니다.")
    console.log("  Supabase SQL Editor에서 database/000_migration_tracker.sql 을 먼저 실행하세요.")
    console.log("")
    if (statusOnly) process.exit(1)
  }

  // 1. 적용된 마이그레이션 조회
  const { data: applied } = await supabase
    .from("_migrations")
    .select("name, applied_at")
    .order("id", { ascending: true })

  const appliedSet = new Set((applied ?? []).map((m: { name: string }) => m.name))

  // 2. 상태 표시
  console.log("\n=== NOX Migration Status ===\n")

  const pending: string[] = []

  for (const migration of MIGRATIONS) {
    if (migration === "000_migration_tracker.sql") {
      // tracker는 별도 관리
      continue
    }
    const isApplied = appliedSet.has(migration)
    const mark = isApplied ? "✓" : "○"
    const status = isApplied
      ? `applied ${(applied ?? []).find((m: { name: string }) => m.name === migration)?.applied_at ?? ""}`
      : "pending"
    console.log(`  ${mark} ${migration.padEnd(35)} ${status}`)

    if (!isApplied) {
      pending.push(migration)
    }
  }

  console.log("")
  console.log(`  Total: ${MIGRATIONS.length - 1} | Applied: ${appliedSet.size} | Pending: ${pending.length}`)
  console.log("")

  if (statusOnly) {
    process.exit(0)
  }

  if (pending.length === 0) {
    console.log("✓ All migrations are up to date.\n")
    process.exit(0)
  }

  if (dryRun) {
    console.log("DRY RUN — would apply:")
    for (const m of pending) console.log(`  → ${m}`)
    console.log("")
    process.exit(0)
  }

  // 3. 미적용 마이그레이션 실행
  console.log(`Applying ${pending.length} migration(s)...\n`)

  for (const migration of pending) {
    const filePath = path.join(__dirname, "..", "database", migration)

    if (!fs.existsSync(filePath)) {
      console.error(`  ✗ ${migration} — file not found: ${filePath}`)
      process.exit(1)
    }

    const sql = fs.readFileSync(filePath, "utf-8")
    console.log(`  → ${migration}...`)

    // SQL 실행 (rpc exec_sql 또는 직접 fetch)
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseServiceKey,
        Authorization: `Bearer ${supabaseServiceKey}`,
      },
      body: JSON.stringify({ sql }),
    })

    if (!res.ok) {
      // rpc가 없는 경우 — Supabase Management API 또는 수동 실행 안내
      const errText = await res.text()

      if (errText.includes("exec_sql") || errText.includes("not found")) {
        console.error(`\n  ✗ exec_sql RPC가 설정되지 않았습니다.`)
        console.error(`    Supabase SQL Editor에서 아래를 먼저 실행하세요:\n`)
        console.error(`    CREATE OR REPLACE FUNCTION exec_sql(sql TEXT) RETURNS VOID AS $$`)
        console.error(`    BEGIN EXECUTE sql; END;`)
        console.error(`    $$ LANGUAGE plpgsql SECURITY DEFINER;\n`)
        console.error(`    또는 직접 SQL Editor에서 database/${migration} 을 실행하세요.`)
        process.exit(1)
      }

      console.error(`  ✗ ${migration} — FAILED: ${errText}`)
      process.exit(1)
    }

    // 적용 기록
    const { error: insertError } = await supabase
      .from("_migrations")
      .insert({ name: migration })

    if (insertError) {
      console.error(`  ✗ ${migration} — SQL succeeded but failed to record: ${insertError.message}`)
      process.exit(1)
    }

    console.log(`    ✓ applied`)
  }

  console.log(`\n✓ All ${pending.length} migration(s) applied successfully.\n`)
}

main().catch((err) => {
  console.error("Unexpected error:", err)
  process.exit(1)
})
