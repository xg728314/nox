import { describe, it, expect } from "vitest"
import {
  checkBaseLifecycleGate,
  checkResolvable,
  checkDisputeScopeGate,
  type WorkLogRow,
} from "@/lib/server/queries/staffWorkLogLifecycle"
import type { AuthContext } from "@/lib/auth/resolveAuthContext"

/**
 * Lifecycle gates — pure (row, auth) → LifecycleError | null.
 *
 * Covers state-transition refusal + scope enforcement used by
 * confirm / void / dispute / resolve routes before any UPDATE.
 */

const STORE_A = "00000000-0000-0000-0000-00000000000a"
const STORE_B = "00000000-0000-0000-0000-00000000000b"

function row(over: Partial<WorkLogRow> = {}): WorkLogRow {
  return {
    id: "log-1",
    origin_store_uuid: STORE_A,
    working_store_uuid: STORE_A,
    hostess_membership_id: "h-1",
    manager_membership_id: "mgr-1",
    status: "draft",
    created_by: "user-1",
    created_by_role: "manager",
    voided_by: null,
    voided_at: null,
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
  it("settled → SETTLED_LOCKED 400", () => {
    const e = checkBaseLifecycleGate(row({ status: "settled" }), auth())
    expect(e).not.toBeNull()
    expect(e?.error).toBe("SETTLED_LOCKED")
    expect(e?.status).toBe(400)
  })

  it("voided → INVALID_STATE_TRANSITION 400", () => {
    const e = checkBaseLifecycleGate(row({ status: "voided" }), auth())
    expect(e).not.toBeNull()
    expect(e?.error).toBe("INVALID_STATE_TRANSITION")
    expect(e?.status).toBe(400)
  })

  it("draft passes for owner in same origin store", () => {
    const e = checkBaseLifecycleGate(row({ status: "draft" }), auth({ role: "owner" }))
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

describe("checkResolvable — disputed → confirmed gate", () => {
  it("non-disputed status → STATE_CONFLICT 409", () => {
    const e = checkResolvable(row({ status: "draft" }), auth())
    expect(e?.error).toBe("STATE_CONFLICT")
    expect(e?.status).toBe(409)
  })

  it("settled → SETTLED_LOCKED 400 (precedence over STATE_CONFLICT)", () => {
    const e = checkResolvable(row({ status: "settled" }), auth())
    expect(e?.error).toBe("SETTLED_LOCKED")
    expect(e?.status).toBe(400)
  })

  it("voided → INVALID_STATE_TRANSITION 400", () => {
    const e = checkResolvable(row({ status: "voided" }), auth())
    expect(e?.error).toBe("INVALID_STATE_TRANSITION")
    expect(e?.status).toBe(400)
  })

  it("disputed + manager_membership_id null → MANAGER_REQUIRED 400", () => {
    const e = checkResolvable(
      row({ status: "disputed", manager_membership_id: null }),
      auth(),
    )
    expect(e?.error).toBe("MANAGER_REQUIRED")
    expect(e?.status).toBe(400)
  })

  it("disputed + assigned manager + owner origin → passes", () => {
    const e = checkResolvable(
      row({ status: "disputed", manager_membership_id: "mgr-2" }),
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
      row({ status: "disputed", origin_store_uuid: STORE_B, manager_membership_id: "mgr" }),
      auth({ store_uuid: STORE_A, is_super_admin: true }),
    )
    expect(e).toBeNull()
  })
})

// ─── checkDisputeScopeGate ──────────────────────────────────────

describe("checkDisputeScopeGate — origin OR working store allowed", () => {
  it("settled → SETTLED_LOCKED regardless of scope", () => {
    const e = checkDisputeScopeGate(row({ status: "settled" }), auth())
    expect(e?.error).toBe("SETTLED_LOCKED")
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
