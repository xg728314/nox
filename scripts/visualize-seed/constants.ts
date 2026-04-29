/**
 * Visualize seed — shared constants.
 *
 * Single source of truth for the test-data identifiers consumed by both
 * `seed.ts` and `cleanup.ts`. Touching anything here changes both
 * scripts; the SQL backup (`database/cleanup_visualize_seed.sql`) must
 * be updated by hand to match.
 */

// ─── Test store UUIDs ────────────────────────────────────────────────
//
// Deterministic, all-`a` prefix. The probability of a collision with an
// operational `gen_random_uuid()` value is essentially zero — every
// nibble being `a` would require 32 specific outcomes (1 in 16^32).
// Cleanup scripts rely on these as the primary store_uuid filter.
export const TEST_STORE_A_UUID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01"
export const TEST_STORE_B_UUID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02"
export const TEST_STORE_UUIDS: readonly string[] = [
  TEST_STORE_A_UUID,
  TEST_STORE_B_UUID,
]

// Email domain → cleanup uses LIKE '%@nox-seed.test' for auth.users.
// `.test` is RFC 2606 reserved — never resolves on the public internet,
// safe for synthetic accounts.
export const TEST_EMAIL_DOMAIN = "@nox-seed.test"
export const TEST_EMAIL_LIKE = `%${TEST_EMAIL_DOMAIN}`

// Default password (override via SEED_PASSWORD env if needed).
export const TEST_PASSWORD = process.env.SEED_PASSWORD ?? "Test1234!"

// ─── Stores ──────────────────────────────────────────────────────────

export const TEST_STORES: ReadonlyArray<{
  id: string
  store_name: string
  store_code: string
  floor: number
}> = [
  {
    id: TEST_STORE_A_UUID,
    store_name: "[TEST] 시드매장 A",
    store_code: "TEST_A",
    floor: 5,
  },
  {
    id: TEST_STORE_B_UUID,
    store_name: "[TEST] 시드매장 B",
    store_code: "TEST_B",
    floor: 6,
  },
]

// ─── Test accounts ───────────────────────────────────────────────────
//
// Realistic Korean names — visualize verification needs to look like
// production data so masking/unmask flows are exercised honestly. Each
// row maps to one auth.users + one profiles + one store_memberships.

export type TestAccount = {
  email: string
  full_name: string
  nickname: string | null
  /** For hostess display. Non-PII performer alias. */
  stage_name: string | null
  role: "owner" | "manager" | "hostess"
  store_uuid: string
}

export const TEST_ACCOUNTS: readonly TestAccount[] = [
  // Store A — owner (visualize-only; not used as actor for sessions)
  {
    email: `owner-a${TEST_EMAIL_DOMAIN}`,
    full_name: "홍길동",
    nickname: "테스트사장",
    stage_name: null,
    role: "owner",
    store_uuid: TEST_STORE_A_UUID,
  },
  // Store A — manager
  {
    email: `manager-a${TEST_EMAIL_DOMAIN}`,
    full_name: "박지훈",
    nickname: "지훈실장",
    stage_name: null,
    role: "manager",
    store_uuid: TEST_STORE_A_UUID,
  },
  // Store A — hostess #1 (managed by manager-a)
  {
    email: `hostess-a1${TEST_EMAIL_DOMAIN}`,
    full_name: "김민지",
    nickname: null,
    stage_name: "민지",
    role: "hostess",
    store_uuid: TEST_STORE_A_UUID,
  },
  // Store A — hostess #2 (managed by manager-a; will also work cross-store at B)
  {
    email: `hostess-a2${TEST_EMAIL_DOMAIN}`,
    full_name: "이서연",
    nickname: null,
    stage_name: "서연",
    role: "hostess",
    store_uuid: TEST_STORE_A_UUID,
  },
  // Store B — manager
  {
    email: `manager-b${TEST_EMAIL_DOMAIN}`,
    full_name: "최우진",
    nickname: "우진실장",
    stage_name: null,
    role: "manager",
    store_uuid: TEST_STORE_B_UUID,
  },
  // Store B — hostess #1
  {
    email: `hostess-b1${TEST_EMAIL_DOMAIN}`,
    full_name: "정수아",
    nickname: null,
    stage_name: "수아",
    role: "hostess",
    store_uuid: TEST_STORE_B_UUID,
  },
]

// ─── Rooms ───────────────────────────────────────────────────────────

export type TestRoomDef = {
  store_uuid: string
  room_no: string
  room_name: string
  floor_no: number
  sort_order: number
}

export const TEST_ROOMS: readonly TestRoomDef[] = [
  { store_uuid: TEST_STORE_A_UUID, room_no: "1", room_name: "A호 1번방", floor_no: 5, sort_order: 1 },
  { store_uuid: TEST_STORE_A_UUID, room_no: "2", room_name: "A호 2번방", floor_no: 5, sort_order: 2 },
  { store_uuid: TEST_STORE_B_UUID, room_no: "1", room_name: "B호 1번방", floor_no: 6, sort_order: 1 },
  { store_uuid: TEST_STORE_B_UUID, room_no: "2", room_name: "B호 2번방", floor_no: 6, sort_order: 2 },
]

// ─── Service types (체크인 안전 — 1 row per store) ─────────────────

export const TEST_SERVICE_TYPES: ReadonlyArray<{
  service_type: string
  time_type: string
  time_minutes: number
  price: number
  manager_deduction: number
}> = [
  {
    service_type: "퍼블릭",
    time_type: "기본",
    time_minutes: 90,
    price: 130_000,
    manager_deduction: 10_000,
  },
]

// ─── Marker prefix for free-text fields ─────────────────────────────
//
// Anywhere we have a free text field (notes/note/reason) we drop a
// `[TEST_SEED]` prefix so a casual reader can spot synthetic data.

export const TEST_NOTE_PREFIX = "[TEST_SEED]"
