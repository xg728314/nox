The file is already fully implemented and correct. No changes are needed.

---

**FILES CHANGED:**
- None (file already contains the correct implementation)

**ROOT CAUSE:**
- The endpoint was already implemented in full. All constraints are satisfied as-is.

**EXACT DIFF:**
- No changes made.

**VALIDATION:**

| Check | Result |
|---|---|
| **Role gate** | Line 10: `authContext.role !== "manager"` → 403 `ROLE_FORBIDDEN`, before any DB access |
| **Assignment filter** | Lines 30–34: queries `manager_hostess_assignments` filtered by `store_uuid` AND `manager_membership_id` (authContext.user_id); only assigned hostesses are iterated |
| **Store scope** | All queries use `.eq("store_uuid", authContext.store_uuid)` — lines 33, 61, 74 |
| **Response shape** | Returns `{ store_uuid, role: "manager", summary: [{ hostess_id, has_settlement, status }] }` — no payout amounts, no calculation, no settlement detail beyond status |
