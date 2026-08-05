#!/usr/bin/env node
/**
 * NFC 태그 UUID 발급 script.
 *
 * 각 매장 (5~8F) 마다:
 *   - 각 방 별 tag_type='room' 태그 1개
 *   - 매장 공통 tag_type='waiter_call' 1개
 *   - 매장 공통 tag_type='purchase' 1개
 *   - 매장 공통 tag_type='toilet' 1개
 *   - 매장 공통 tag_type='manager_call' 1개
 *
 * 결과: 매장당 5~8 (방수) + 4 = 9~12 태그 · 15매장 * 10평균 = ~150 태그
 *
 * 출력:
 *   - stdout: SQL INSERT 문 (dry-run · 검수 후 apply)
 *   - stderr: 통계
 *
 * 실행:
 *   node scripts/nfc-generate-tags.mjs > /tmp/nfc-tags.sql
 *   (검토 후 Supabase SQL 에디터에서 실행)
 */
import fs from "node:fs"
import crypto from "node:crypto"
import { fileURLToPath } from "node:url"
import path from "node:path"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ENV_PATH = path.resolve(__dirname, "../.env.local")
const env = {}
for (const line of fs.readFileSync(ENV_PATH, "utf8").split("\n")) {
  const m = line.trim().match(/^([^#=]+)=(.*)$/)
  if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "")
}
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}

async function req(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

const stores = await req("/stores?deleted_at=is.null&floor=in.(5,6,7,8)&select=id,store_name,floor&order=floor.asc,store_name.asc")
console.error(`stores: ${stores.length}`)

const rooms = await req(`/rooms?deleted_at=is.null&store_uuid=in.(${stores.map((s) => s.id).join(",")})&select=id,store_uuid,room_no,sort_order&order=store_uuid.asc,sort_order.asc`)
console.error(`rooms: ${rooms.length}`)

const roomsByStore = new Map()
for (const r of rooms) {
  if (!roomsByStore.has(r.store_uuid)) roomsByStore.set(r.store_uuid, [])
  roomsByStore.get(r.store_uuid).push(r)
}

const COMMON = [
  { tag_type: "waiter_call", label: "웨이터 호출" },
  { tag_type: "purchase", label: "사입 요청" },
  { tag_type: "toilet", label: "화장실" },
  { tag_type: "manager_call", label: "실장 호출" },
]

console.log("-- NFC 태그 발급 (auto-generated)")
console.log("-- 생성일:", new Date().toISOString())
console.log("BEGIN;")

let tagCount = 0
for (const store of stores) {
  console.log(`\n-- ${store.floor}F ${store.store_name}`)
  const storeRooms = roomsByStore.get(store.id) ?? []
  // 방별 태그
  for (const room of storeRooms) {
    const tagUuid = crypto.randomUUID()
    console.log(`INSERT INTO room_nfc_tags (tag_uuid, store_uuid, room_uuid, tag_type, label, location_note) VALUES ('${tagUuid}', '${store.id}', '${room.id}', 'room', '${room.room_no}번방', '${store.store_name} · ${room.room_no}번방 입구');`)
    tagCount++
  }
  // 매장 공통 태그
  for (const c of COMMON) {
    const tagUuid = crypto.randomUUID()
    console.log(`INSERT INTO room_nfc_tags (tag_uuid, store_uuid, tag_type, label, location_note) VALUES ('${tagUuid}', '${store.id}', '${c.tag_type}', '${c.label}', '${store.store_name} · 카운터');`)
    tagCount++
  }
}

console.log("\nCOMMIT;")
console.error(`총 ${tagCount} 태그 발급 · SQL Editor 에서 실행 후 각 tag_uuid 를 스티커 인쇄`)
