import { describe, it, expect } from "vitest"
import {
  checkBaseLifecycleGate,
  checkResolvable,
  checkDisputeScopeGate,
  type WorkLogRow,
} from "@/lib/server/queries/staff/workLogLifecycle"
import type { AuthContext } from "@/lib/auth/resolveAuthContext"

/**
 * Lifecycle gates — pure (row, auth) → LifecycleError | null.
 *
 * cross_store_work_records (2026-04-24 수정) 기준. 이전 staff_work_logs
 * 스키마 (manager_membership_id / created_by / settled / confirmed_by 등)
 * 는 제거됐다.
 *
 * 상태 전이: pending → confirmed → disputed → resolved
 *            any → voided
 */

const STORE_A = "00000000-0000-0000-0000-00000000000a"
const STORE_B = "00000000-0000-0000-0000-00000000000b"

function row(over: Partial<WorkLogRow> = {}): WorkLogRow {
  return {
    id: "log-1",
    session_id: "00000000-0000-0000-0000-0000000000aa",
    business_day_id: "00000000-0000-0000-0000-0000000000bb",
    origin_store_uuid: STORE_A,
    working_store_uuid: STORE_A,
    hostess_membership_id: "h-1",
    requested_by: "mgr-1",
    approved_by: null,
    approved_at: null,
    status: "pending",
    ...over,
  }
}

function auth(over: Partial<AuthContext> = {}): AuthContext {
  return {
    user_id: "user-1",
    membership_id: "mgr-1",
    store_uuid: STORE_A,
    role: "owner",
    membership_status: "approved",
    global_roles: [],
    is_super_admin: false,
    ...over,
  }
}

// ─── checkBaseLifecycleGate ────────────────────────────────────

describe("checkBaseLifecycleGate — terminal state locks", () => {
  it("resolved → INVALID_STATE_TRANSITION 400", () => {
    const e = checkBaseLifecycleGate(row({ status: "resolved" }), auth())
    expect(e).not.toBeNull()
    expect(e?.error).toBe("INVALID_STATE_TRANSITION")
    expect(e?.status).toBe(400)
  })

  it("voided → INVALID_STATE_TRANSITION 400", () => {
    const e = checkBaseLifecycleGate(row({ status: "voided" }), auth())
    expect(e).not.toBeNull()
    expect(e?.error).toBe("INVALID_STATE_TRANSITION")
    expect(e?.status).toBe(400)
  })

  it("pending passes for owner in same origin store", () => {
    const e = checkBaseLifecycleGate(row({ status: "pending" }), auth({ role: "owner" }))
    expect(e).toBeNull()
  })

  it("confirmed passes for owner in same origin store", () => {
    const e = checkBaseLifecycleGate(row({ status: "confirmed" }), auth({ role: "owner" }))
    expect(e).toBeNull()
  })
})

describe("checkBaseLifecycleGate — store scope", () => {
  it("non-super_admin with mismatched origin → STORE_SCOPE_FORBIDDEN 403", () => {
    const e = checkBaseLifecycleGate(
      row({ origin_store_uuid: STORE_B }),
      auth({ store_uuid: STORE_A }),
    )
    expect(e?.error).toBe("STORE_SCOPE_FORBIDDEN")
    expect(e?.status).toBe(403)
  })

  it("super_admin bypasses store scope", () => {
    const e = checkBaseLifecycleGate(
      row({ origin_store_uuid: STORE_B }),
      auth({ store_uuid: STORE_A, is_super_admin: true }),
    )
    expect(e).toBeNull()
  })
})

// ─── checkResolvable ────────────────────────────────────────────

describe("checkResolvable — disputed → resolved gate", () => {
  it("non-disputed status → STATE_CONFLICT 409", () => {
    const e = checkResolvable(row({ status: "pending" }), auth())
    expect(e?.error).toBe("STATE_CONFLICT")
    expect(e?.status).toBe(409)
  })

  it("resolved → INVALID_STATE_TRANSITION 400", () => {
    const e = checkResolvable(row({ status: "resolved" }), auth())
    expect(e?.error).toBe("INVALID_STATE_TRANSITION")
    expect(e?.status).toBe(400)
  })

  it("voided → INVALID_STATE_TRANSITION 400", () => {
    const e = checkResolvable(row({ status: "voided" }), auth())
    expect(e?.error).toBe("INVALID_STATE_TRANSITION")
    expect(e?.status).toBe(400)
  })

  it("disputed + owner origin → passes", () => {
    const e = checkResolvable(
      row({ status: "disputed" }),
      auth({ role: "owner", store_uuid: STORE_A }),
    )
    expect(e).toBeNull()
  })

  it("disputed but cross-store non-super_admin → STORE_SCOPE_FORBIDDEN 403", () => {
    const e = checkResolvable(
      row({ status: "disputed", origin_store_uuid: STORE_B }),
      auth({ store_uuid: STORE_A }),
    )
    expect(e?.error).toBe("STORE_SCOPE_FORBIDDEN")
  })

  it("disputed super_admin in any store → passes", () => {
    const e = checkResolvable(
      row({ status: "disputed", origin_store_uuid: STORE_B }),
      auth({ store_uuid: STORE_A, is_super_admin: true }),
    )
    expect(e).toBeNull()
  })
})

// ─── checkDisputeScopeGate ──────────────────────────────────────

describe("checkDisputeScopeGate — origin OR working store allowed", () => {
  it("resolved → INVALID_STATE_TRANSITION regardless of scope", () => {
    const e = checkDisputeScopeGate(row({ status: "resolved" }), auth())
    expect(e?.error).toBe("INVALID_STATE_TRANSITION")
  })

  it("voided → INVALID_STATE_TRANSITION", () => {
    const e = checkDisputeScopeGate(row({ status: "voided" }), auth())
    expect(e?.error).toBe("INVALID_STATE_TRANSITION")
  })

  it("caller at origin store → passes", () => {
    const e = checkDisputeScopeGate(
      row({ origin_store_uuid: STORE_A, working_store_uuid: STORE_B, status: "confirmed" }),
      auth({ store_uuid: STORE_A }),
    )
    expect(e).toBeNull()
  })

  it("caller at working store (cross-store) → passes", () => {
    const e = checkDisputeScopeGate(
      row({ origin_store_uuid: STORE_A, working_store_uuid: STORE_B, status: "confirmed" }),
      auth({ store_uuid: STORE_B }),
    )
    expect(e).toBeNull()
  })

  it("caller at neither origin nor working → STORE_SCOPE_FORBIDDEN 403", () => {
    const e = checkDisputeScopeGate(
      row({ origin_store_uuid: STORE_A, working_store_uuid: STORE_B, status: "confirmed" }),
      auth({ store_uuid: "00000000-0000-0000-0000-00000000000c" }),
    )
    expect(e?.error).toBe("STORE_SCOPE_FORBIDDEN")
    expect(e?.status).toBe(403)
  })

  it("super_admin bypasses store scope for dispute", () => {
    const e = checkDisputeScopeGate(
      row({ origin_store_uuid: STORE_A, working_store_uuid: STORE_B, status: "confirmed" }),
      auth({ store_uuid: "00000000-0000-0000-0000-00000000000c", is_super_admin: true }),
    )
    expect(e).toBeNull()
  })
})
