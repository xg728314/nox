# NOX_AUTH_CONTEXT_SPEC

## 1. Auth Context Definition

Auth Context is the minimal identity payload attached to every authenticated request.
It is not a database row. It is a runtime object derived from verified token + store membership lookup.

### 1.1 Required Fields

| Field | Type | Source | Description |
|-------|------|--------|-------------|
| user_id | uuid | token claim | Authenticated user identity |
| store_uuid | uuid | verified store_memberships resolution | Security scope boundary |
| role | enum | store_memberships.role | owner / manager / hostess |
| membership_status | enum | store_memberships.status | approved / pending / rejected / suspended |

### 1.2 Optional Fields

| Field | Type | Source | Description |
|-------|------|--------|-------------|
| session_id | uuid | verified session lookup by store_uuid | Current session runtime identity (present only in session-scoped operations) |
| room_uuid | uuid | derived from verified session | Canonical room identity (never room_no) |

---

## 2. Identity Rules

1. user_id is the sole user identifier. No email, phone, or display_name in auth context.
2. session_id is a runtime identity. It exists only when the request operates within a session.
3. room_uuid is the canonical room identifier. room_no must never appear in auth context.
4. customer is not a login account. Auth context is never created for a customer participant.

---

## 3. Store Scope Rules

1. Every auth context must contain exactly one store_uuid.
2. store_uuid determines the security boundary for all data access.
3. store_uuid is resolved from the user's verified store membership. Each authenticated context binds to exactly one store_uuid.
4. All downstream queries must filter by the store_uuid from auth context.
5. Cross-store data access is forbidden. No request may read or write data outside its store_uuid scope.
6. Global queries (no store_uuid filter) are forbidden.

---

## 4. Invalid State Examples

| # | State | Why Invalid |
|---|-------|-------------|
| 1 | auth context without user_id | No anonymous writes allowed |
| 2 | auth context without store_uuid | No data access possible without scope |
| 3 | auth context with role but no store_uuid | Role is meaningless without store scope |
| 4 | auth context with store_uuid the user has no membership for | Access must be backed by store_memberships record |
| 5 | auth context with membership_status = rejected or suspended performing write | Rejected/suspended users cannot perform write operations |
| 6 | auth context with membership_status = pending performing write (except limited read) | Pending users have restricted access |
| 7 | auth context containing room_no instead of room_uuid | room_no is display only, not an identifier |
| 8 | auth context with session_id belonging to a different store_uuid | session_id must be within the same store scope |
| 9 | auth context created for a customer participant | Customers are not login accounts |
| 10 | auth context with multiple store_uuid values | Exactly one store scope per request |

---

## 5. Validation Checklist

- [ ] user_id is present and non-empty
- [ ] store_uuid is present and non-empty
- [ ] role is one of: owner / manager / hostess
- [ ] membership_status is one of: approved / pending / rejected / suspended
- [ ] user_id has an active store_memberships record for the given store_uuid
- [ ] membership_status permits the requested operation
- [ ] if session_id is present, it belongs to the same store_uuid
- [ ] if room_uuid is present, it is a uuid (not room_no)
- [ ] no customer identity is used as auth context
- [ ] no cross-store reference exists in the request payload
