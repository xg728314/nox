/**
 * Visualize diagnose — direct DB shape inspection.
 * Why does the network graph show stores but no edges?
 *
 * Run: npx tsx --env-file=.env.local scripts/visualize-seed/diagnose-db.ts
 */

import { createClient } from "@supabase/supabase-js"
import { TEST_STORE_UUIDS } from "./constants"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("env missing")
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function count(label: string, q: any): Promise<void> {
  const { count, error } = await q
  if (error) console.log(`${label}: ERROR ${error.message}`)
  else console.log(`${label}: ${count}`)
}

async function main() {
  console.log("─── stores ───")
  await count("stores total (active)", supabase.from("stores").select("id", { count: "exact", head: true }).is("deleted_at", null).eq("is_active", true))
  console.log("\n─── memberships (filter as visualize does) ───")
  await count("memberships approved+primary+manager", supabase.from("store_memberships").select("id", { count: "exact", head: true }).eq("status", "approved").eq("is_primary", true).eq("role", "manager").is("deleted_at", null))
  await count("memberships approved+primary+hostess", supabase.from("store_memberships").select("id", { count: "exact", head: true }).eq("status", "approved").eq("is_primary", true).eq("role", "hostess").is("deleted_at", null))
  await count("memberships approved+primary+waiter", supabase.from("store_memberships").select("id", { count: "exact", head: true }).eq("status", "approved").eq("is_primary", true).eq("role", "waiter").is("deleted_at", null))
  await count("memberships approved+primary+staff", supabase.from("store_memberships").select("id", { count: "exact", head: true }).eq("status", "approved").eq("is_primary", true).eq("role", "staff").is("deleted_at", null))

  console.log("\n─── memberships (without filter) ───")
  await count("memberships total (any status, any is_primary)", supabase.from("store_memberships").select("id", { count: "exact", head: true }).is("deleted_at", null))
  await count("memberships role=hostess (any)", supabase.from("store_memberships").select("id", { count: "exact", head: true }).eq("role", "hostess").is("deleted_at", null))
  await count("memberships role=manager (any)", supabase.from("store_memberships").select("id", { count: "exact", head: true }).eq("role", "manager").is("deleted_at", null))

  console.log("\n─── hostesses table ───")
  await count("hostesses total active", supabase.from("hostesses").select("id", { count: "exact", head: true }).is("deleted_at", null).eq("is_active", true))
  // sample one to see manager_membership_id
  const { data: hostessSample } = await supabase.from("hostesses").select("id, store_uuid, membership_id, manager_membership_id, name, stage_name, is_active").is("deleted_at", null).eq("is_active", true).limit(3)
  for (const h of hostessSample ?? []) {
    console.log(`  hostess ${h.name ?? h.stage_name}: membership_id=${h.membership_id} manager_membership=${h.manager_membership_id ?? "(null)"}`)
    // Verify membership is approved+primary
    const { data: m } = await supabase.from("store_memberships").select("status, is_primary").eq("id", h.membership_id).maybeSingle()
    console.log(`     membership status=${m?.status} is_primary=${m?.is_primary}`)
  }

  console.log("\n─── managers table ───")
  await count("managers total active", supabase.from("managers").select("id", { count: "exact", head: true }).is("deleted_at", null).eq("is_active", true))
  const { data: mgrSample } = await supabase.from("managers").select("id, store_uuid, membership_id, name, is_active").is("deleted_at", null).eq("is_active", true).limit(3)
  for (const m of mgrSample ?? []) {
    console.log(`  manager ${m.name}: membership_id=${m.membership_id}`)
    const { data: mem } = await supabase.from("store_memberships").select("status, is_primary, role").eq("id", m.membership_id).maybeSingle()
    console.log(`     membership status=${mem?.status} is_primary=${mem?.is_primary} role=${mem?.role}`)
  }

  console.log("\n─── operating days (today) ───")
  const today = new Date().toISOString().slice(0, 10)
  await count(`operating_days today=${today}`, supabase.from("store_operating_days").select("id", { count: "exact", head: true }).eq("business_date", today).is("deleted_at", null))
  // any recent
  const { data: recentDays } = await supabase.from("store_operating_days").select("id, store_uuid, business_date").is("deleted_at", null).order("business_date", { ascending: false }).limit(5)
  console.log("  recent operating days:")
  for (const d of recentDays ?? []) console.log(`    ${d.business_date} store=${d.store_uuid}`)

  console.log("\n─── room_sessions ───")
  await count("room_sessions total (not deleted)", supabase.from("room_sessions").select("id", { count: "exact", head: true }).is("deleted_at", null))
  await count("room_sessions today's days", supabase.from("room_sessions").select("id", { count: "exact", head: true }).is("deleted_at", null).gte("started_at", `${today}T00:00:00Z`))

  console.log("\n─── settlements ───")
  await count("settlements total", supabase.from("settlements").select("id", { count: "exact", head: true }).is("deleted_at", null))

  console.log("\n─── audit_events (90 days) ───")
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
  await count("audit_events 90 days", supabase.from("audit_events").select("id", { count: "exact", head: true }).gte("created_at", ninetyDaysAgo))

  console.log("\n─── test seed presence ───")
  await count("test stores present", supabase.from("stores").select("id", { count: "exact", head: true }).in("id", TEST_STORE_UUIDS as readonly string[] as string[]))
}

main().catch((e) => {
  console.error("FATAL", e)
  process.exit(1)
})
