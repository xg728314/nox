import { describe, it, expect } from "vitest"
import { auditOr500, logAuditEvent, AuditWriteError } from "@/lib/audit/logEvent"
import type { AuthContext } from "@/lib/auth/resolveAuthContext"

/**
 * auditOr500 / logAuditEvent — fail-close helper.
 *
 * ROUND-A 에서 mutation-path audit 가 fail-open → fail-close 로 전환됨.
 * 본 테스트는 응답 shape 과 에러 클래스의 계약을 고정.
 */

const auth: AuthContext = {
  user_id: "u",
  membership_id: "m",
  store_uuid: "s",
  role: "owner",
  membership_status: "approved",
  global_roles: [],
  is_super_admin: false,
}

type InsertResult = { error: { message: string } | null }

// Minimal supabase client stub. Only the insert path used by audit.
type StubClient = {
  from: (t: string) => {
    insert: (p: unknown) => Promise<InsertResult>
  }
}

function makeStub(result: InsertResult): StubClient {
  return {
    from: (t: string) => {
      expect(t).toBe("audit_events")
      return {
        insert: async () => result,
      }
    },
  }
}

describe("logAuditEvent — fail-close", () => {
  it("returns normally on insert success", async () => {
    const supa = makeStub({ error: null })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(logAuditEvent(supa as any, {
      auth,
      action: "test_ok",
      entity_table: "store_memberships",
      entity_id: "entity-1",
    })).resolves.toBeUndefined()
  })

  it("throws AuditWriteError on insert failure (ROUND-A contract)", async () => {
    const supa = makeStub({ error: { message: "DB down" } })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(logAuditEvent(supa as any, {
      auth,
      action: "test_fail",
      entity_table: "store_memberships",
      entity_id: "entity-1",
    })).rejects.toBeInstanceOf(AuditWriteError)
  })

  it("AuditWriteError carries action + DB message", async () => {
    const supa = makeStub({ error: { message: "unique_violation" } })
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await logAuditEvent(supa as any, {
        auth,
        action: "member_created",
        entity_table: "store_memberships",
        entity_id: "e",
      })
      expect.fail("should throw")
    } catch (e) {
      expect(e).toBeInstanceOf(AuditWriteError)
      expect((e as AuditWriteError).action).toBe("member_created")
      expect((e as AuditWriteError).message).toMatch(/unique_violation/)
    }
  })
})

describe("auditOr500 — wraps into NextResponse|null", () => {
  it("returns null on success", async () => {
    const supa = makeStub({ error: null })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await auditOr500(supa as any, {
      auth,
      action: "ok",
      entity_table: "store_memberships",
      entity_id: "e",
    })
    expect(r).toBeNull()
  })

  it("returns 500 NextResponse with AUDIT_WRITE_FAILED on failure", async () => {
    const supa = makeStub({ error: { message: "boom" } })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await auditOr500(supa as any, {
      auth,
      action: "staff_work_log_confirmed",
      entity_table: "store_memberships",
      entity_id: "e",
    })
    expect(r).not.toBeNull()
    if (r) {
      expect(r.status).toBe(500)
      const body = await r.json()
      expect(body.error).toBe("AUDIT_WRITE_FAILED")
      expect(body.action).toBe("staff_work_log_confirmed")
      expect(body.detail).toBe("boom")
    }
  })

  it("success response does not leak internal details", async () => {
    const supa = makeStub({ error: null })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await auditOr500(supa as any, {
      auth,
      action: "ok",
      entity_table: "store_memberships",
      entity_id: "e",
    })
    // success path returns null — no body to leak
    expect(r).toBeNull()
  })
})

describe("AuditWriteError — class shape", () => {
  it("extends Error with name='AuditWriteError'", () => {
    const e = new AuditWriteError("foo", "bar")
    expect(e).toBeInstanceOf(Error)
    expect(e.name).toBe("AuditWriteError")
    expect(e.action).toBe("foo")
    expect(e.message).toBe("bar")
  })
})
