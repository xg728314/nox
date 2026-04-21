# NOX_AUTH_FLOW_SPEC

## 1. Authentication Entry Flow

1. Request arrives with token in header.
2. Token is validated for structure, signature, and expiration.
3. If valid, extract user_id from token claim.
4. If invalid, reject immediately.

### Failure Conditions

| Condition | Result |
|-----------|--------|
| Token missing | Reject. No anonymous access for write operations. |
| Token malformed | Reject. Cannot extract claims. |
| Token signature invalid | Reject. Tampered or forged token. |
| Token expired | Reject. Must re-authenticate. |
| user_id claim missing from valid token | Reject. Identity cannot be established. |

---

## 2. Membership Resolution Flow

1. Extract user_id from verified token.
2. Look up store_memberships record where user_id matches and membership is associated with a store.
3. Resolve store_uuid from the verified membership record.
4. Resolve role from the membership record (owner / manager / hostess).
5. Resolve membership_status from the membership record (approved / pending / rejected / suspended).

### Failure Cases

| Condition | Result |
|-----------|--------|
| No store_memberships record exists for user_id | Reject. User has no store association. |
| Membership record exists but store_uuid is null | Reject. Invalid membership data. |
| Role value is not one of owner / manager / hostess | Reject. Unknown role. |
| Membership status is not one of approved / pending / rejected / suspended | Reject. Unknown status. |

---

## 3. Auth Context Construction Flow

1. Set user_id from token claim.
2. Set store_uuid from verified membership resolution.
3. Set role from membership record.
4. Set membership_status from membership record.
5. All four required fields must be non-empty. If any is missing, reject.
6. If the operation is session-scoped:
   a. Resolve session_id by verified session lookup filtered by store_uuid.
   b. Verify session belongs to the same store_uuid.
   c. If session_id is valid, derive room_uuid from the verified session record.
7. If the operation is not session-scoped, session_id and room_uuid remain absent.

Auth context is now constructed. No field may be added after this point.

---

## 4. Request Validation Flow

Every request with a constructed auth context must pass the following validations in order.

### 4.1 store_uuid Enforcement

1. Confirm store_uuid is present in auth context.
2. Confirm all data access in the request is filtered by this store_uuid.
3. Confirm no cross-store reference exists in the request payload.
4. Confirm no global query (without store_uuid filter) is attempted.

### 4.2 session_id Validation (if present)

1. Confirm session_id belongs to the same store_uuid in auth context.
2. Confirm the session exists and its session_status is checked.
3. If session_status is ended, reject write operations on this session.

### 4.3 room_uuid Validation (if present)

1. Confirm room_uuid is a uuid, not room_no.
2. Confirm room_uuid belongs to the same store_uuid in auth context.

---

## 5. Failure Handling Flow

### 5.1 Explicit Failure Types

| Type | Trigger | Action |
|------|---------|--------|
| AUTH_MISSING | No token provided | Reject request |
| AUTH_INVALID | Token validation failed | Reject request |
| MEMBERSHIP_NOT_FOUND | No store_memberships record for user_id | Reject request |
| MEMBERSHIP_INVALID | Membership record has null or invalid fields | Reject request |
| STORE_SCOPE_VIOLATION | Request references data outside auth context store_uuid | Reject request |
| SESSION_SCOPE_VIOLATION | session_id does not belong to auth context store_uuid | Reject request |
| ROOM_ID_VIOLATION | room_no used instead of room_uuid | Reject request |
| STATUS_BLOCKED | membership_status does not permit the requested operation | Reject request |
| SESSION_CLOSED | Write attempted on ended session | Reject request |

### 5.2 Reject vs Allow Rules

- All failures result in rejection. There is no fallback or degraded access mode.
- Rejection is immediate. No partial execution occurs before rejection.
- A rejected request must not modify any data.

---

## 6. Allowed vs Blocked Operations Matrix

| membership_status | Read | Write |
|-------------------|------|-------|
| approved | Allowed | Allowed |
| pending | Limited read only | Blocked |
| rejected | Blocked | Blocked |
| suspended | Blocked | Blocked |

### Rules

1. Only approved users have full read and write access.
2. Pending users may perform limited read operations only. No write of any kind.
3. Rejected users have no access. All operations blocked.
4. Suspended users have no access. All operations blocked.
5. Customer participants are never authenticated. They do not appear in this matrix.

---

## 7. Flow Diagram (text-based)

```
[1] Request received
 |
[2] Token present?
 |-- NO --> REJECT (AUTH_MISSING)
 |-- YES
 |
[3] Token valid? (structure, signature, expiration)
 |-- NO --> REJECT (AUTH_INVALID)
 |-- YES
 |
[4] Extract user_id from token claim
 |
[5] Lookup store_memberships for user_id
 |-- NOT FOUND --> REJECT (MEMBERSHIP_NOT_FOUND)
 |-- FOUND
 |
[6] Resolve store_uuid, role, membership_status from membership record
 |-- ANY FIELD NULL/INVALID --> REJECT (MEMBERSHIP_INVALID)
 |-- ALL VALID
 |
[7] Construct auth context (user_id, store_uuid, role, membership_status)
 |
[8] membership_status permits operation?
 |-- rejected / suspended --> REJECT (STATUS_BLOCKED)
 |-- pending + write --> REJECT (STATUS_BLOCKED)
 |-- approved OR (pending + limited read)
 |
[9] Session-scoped operation?
 |-- NO --> SKIP to [12]
 |-- YES
 |
[10] Validate session_id belongs to store_uuid
  |-- NO --> REJECT (SESSION_SCOPE_VIOLATION)
  |-- YES
  |
[11] Derive room_uuid from verified session
  |-- room_no used instead --> REJECT (ROOM_ID_VIOLATION)
  |-- room_uuid valid
  |
[12] Validate all data access filtered by store_uuid
  |-- cross-store reference --> REJECT (STORE_SCOPE_VIOLATION)
  |-- global query --> REJECT (STORE_SCOPE_VIOLATION)
  |-- scoped correctly
  |
[13] ALLOW --> Execute request
```
