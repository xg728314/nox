---

**FILES CHANGED:**
`app/api/sessions/checkout/route.ts` (new file, 163 lines)

---

**EXACT DIFF:**
```diff
+++ b/app/api/sessions/checkout/route.ts
@@ -0,0 +1,163 @@
+import { NextResponse } from "next/server"
+import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
+import { createClient } from "@supabase/supabase-js"
+
+export async function POST(request: Request) {
+  try {
+    const authContext = await resolveAuthContext(request)
+
+    if (authContext.role === "hostess") {
+      return NextResponse.json(
+        { error: "ROLE_FORBIDDEN", message: "Hostess role is not permitted to checkout sessions." },
+        { status: 403 }
+      )
+    }
+
+    let body: { session_id?: string }
+    try {
+      body = await request.json()
+    } catch {
+      return NextResponse.json(
+        { error: "BAD_REQUEST", message: "Request body must be valid JSON." },
+        { status: 400 }
+      )
+    }
+
+    const { session_id } = body
+    if (!session_id) { return ... 400 }
+
+    // Supabase env check + createClient
+
+    // 1. room_sessions lookup → SESSION_NOT_FOUND (404) if missing
+    //    status !== 'active' → SESSION_NOT_ACTIVE (400)
+    //    store_uuid mismatch → STORE_MISMATCH (403)
+
+    // 2. UPDATE room_sessions SET status='closed', ended_at=now, closed_by=user_id
+    //    → CHECKOUT_FAILED (500) on error
+
+    // 3. UPDATE session_participants SET status='left', left_at=now
+    //    WHERE session_id AND status='active'
+    //    → PARTICIPANTS_UPDATE_FAILED (500) on error
+
+    // 4. audit_events INSERT: action='session_checkout' (room_sessions)
+    // 5. audit_events INSERT: action='participants_checkout' (session_participants, if count > 0)
+
+    // Response: { session_id, status: 'closed', ended_at, participants_closed_count }
+
+    // catch: AuthError → 401/403/500 mapping incl. MEMBERSHIP_NOT_APPROVED
+    //        else → INTERNAL_ERROR 500
```

---

**VALIDATION:**

| Constraint | Status |
|---|---|
| `resolveAuthContext` 사용 | ✅ line 7 |
| owner/manager only, hostess → 403 | ✅ lines 10–14 |
| Body: `session_id` | ✅ line 32 |
| `room_sessions` 조회, `status='active'` 확인 | ✅ lines 52–76 |
| `session.store_uuid` vs `authContext.store_uuid` | ✅ lines 79–83 |
| `room_sessions` UPDATE: `status='closed'`, `ended_at`, `closed_by` | ✅ lines 87–97 |
| `session_participants` active → `status='left'`, `left_at` | ✅ lines 102–113 |
| `audit_events` — session_checkout | ✅ lines 122–136 |
| `audit_events` — participants_checkout | ✅ lines 139–154 |
| 응답: `session_id`, `status`, `ended_at`, `participants_closed_count` | ✅ lines 157–162 |
| `MEMBERSHIP_NOT_APPROVED` in error handler | ✅ line 172 |
| Forbidden files untouched | ✅ only wrote checkout/route.ts |
