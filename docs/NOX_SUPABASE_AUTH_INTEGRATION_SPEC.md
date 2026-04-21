# NOX_SUPABASE_AUTH_INTEGRATION_SPEC

## 1. Supabase Auth Identity Mapping

### 1.1 User Identity

- Supabase Auth assigns a uuid to each authenticated user via `auth.users.id`.
- NOX user_id is this same uuid. There is no separate user identity system.
- Mapping: `Supabase auth.users.id = NOX users.id = auth context user_id`.

### 1.2 Token Claim Extraction

- The Supabase-issued JWT contains a `sub` claim. This is the user_id.
- Only the `sub` claim is used for identity. No other JWT claims (email, phone, role) are trusted for auth context construction.
- The `sub` claim must be a valid uuid. If not, reject.

---

## 2. Token Handling Rules

### 2.1 Token Location

- Token is read exclusively from the `Authorization` header as a Bearer token.
- No token from query parameters, cookies, or request body is accepted.

### 2.2 Verification Responsibility

- Token signature verification is performed server-side using the Supabase JWT secret.
- The server must verify the token independently. Client-side verification is not trusted.
- Supabase client libraries may decode the token, but the server must re-verify before constructing auth context.

### 2.3 Expiration Handling

- Expired tokens are rejected immediately.
- Token refresh is the client's responsibility. The server does not refresh tokens.
- No grace period for expired tokens.

---

## 3. Membership Resolution Integration

### 3.1 Query Sequence

1. Token is verified. user_id is extracted from the `sub` claim.
2. Query store_memberships where `user_id` matches and the record is associated with a store.
3. From the matched membership record, extract: store_uuid, role, membership_status.

### 3.2 Required Fields for Auth Context

All four required fields must be resolved before auth context is valid:

| Field | Source |
|-------|--------|
| user_id | JWT `sub` claim |
| store_uuid | store_memberships record |
| role | store_memberships.role |
| membership_status | store_memberships.status |

If any field cannot be resolved, reject the request.

---

## 4. store_uuid Resolution Rules

### 4.1 Resolution Method

- store_uuid is determined exclusively from the verified store_memberships record.
- The server queries store_memberships using the verified user_id and resolves store_uuid from the result.

### 4.2 Prohibitions

- store_uuid must never be derived from request path, query parameters, or request body.
- store_uuid must never be accepted from client-provided headers.
- store_uuid must never be extracted from the JWT (Supabase JWT does not carry store_uuid).
- If the client sends a store_uuid in the request, it must be validated against the auth context store_uuid. Mismatch results in rejection.

---

## 5. Auth Context Assembly Boundary

### 5.1 Construction Complete Point

Auth context is considered valid when all four required fields are non-empty and verified:
- user_id: from verified JWT `sub` claim
- store_uuid: from verified store_memberships record
- role: from verified store_memberships record
- membership_status: from verified store_memberships record

### 5.2 Post-Construction Prohibitions

After auth context is constructed:
- No field may be added to auth context.
- No field may be modified.
- No field may be overridden by request data.
- Optional fields (session_id, room_uuid) may only be attached through verified server-side lookup, never from client input.

---

## 6. Supabase Session vs NOX Session Separation

### 6.1 Supabase Session (Auth Session)

- Represents an authenticated login state.
- Managed by Supabase Auth (access token + refresh token).
- Scope: user authentication lifecycle (login, logout, token refresh).
- Has no relation to business operations.

### 6.2 NOX Session (Business Session)

- Identified by session_id.
- Represents a runtime business operation within a room.
- Scope: room occupation from start to termination.
- Bound to store_uuid and room_uuid.
- Has session_status: active / ended.

### 6.3 Separation Rules

1. Supabase session and NOX session_id are completely independent concepts.
2. A Supabase session does not imply an active NOX session exists.
3. A NOX session_id does not imply the Supabase session is still valid.
4. Supabase session expiration does not end a NOX session.
5. NOX session termination does not invalidate the Supabase session.
6. The word "session" alone is ambiguous. All references must specify either "auth session" (Supabase) or "session_id" (NOX business session).

---

## 7. Failure Conditions (Integration Level)

| Condition | Failure Type | Action |
|-----------|-------------|--------|
| Authorization header missing | AUTH_MISSING | Reject |
| Bearer token malformed | AUTH_INVALID | Reject |
| JWT signature verification fails | AUTH_INVALID | Reject |
| JWT expired | AUTH_INVALID | Reject |
| `sub` claim missing or not a valid uuid | AUTH_INVALID | Reject |
| No users record matching user_id | MEMBERSHIP_NOT_FOUND | Reject |
| No store_memberships record for user_id | MEMBERSHIP_NOT_FOUND | Reject |
| store_uuid null in membership record | MEMBERSHIP_INVALID | Reject |
| role not in (owner / manager / hostess) | MEMBERSHIP_INVALID | Reject |
| membership_status not in (approved / pending / rejected / suspended) | MEMBERSHIP_INVALID | Reject |
| Client-provided store_uuid does not match auth context store_uuid | STORE_SCOPE_VIOLATION | Reject |
| session_id references a different store_uuid | SESSION_SCOPE_VIOLATION | Reject |

---

## 8. Security Constraints

### 8.1 No Direct Trust of Client Input

- No identity field (user_id, store_uuid, role, membership_status) may be accepted from client input.
- All identity fields must be resolved server-side from verified sources (JWT + database).
- Client-provided values may only be used as lookup keys after validation against auth context.

### 8.2 Server-Side Verification

- Token verification must happen on the server using the Supabase JWT secret.
- Membership resolution must happen via server-side database query.
- No client-side decoded token data is trusted for auth context.

### 8.3 RLS Alignment

- Supabase Row Level Security (RLS) policies must enforce store_uuid filtering.
- RLS policies must use `auth.uid()` (equivalent to the JWT `sub` claim) as the identity basis.
- RLS is a defense-in-depth layer. Application-level auth context validation must not rely on RLS alone.
- RLS policies must not grant broader access than the application-level auth context permits.
- If application logic and RLS disagree, the more restrictive rule applies.
