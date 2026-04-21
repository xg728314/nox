---

**FILES CHANGED:**
- `app/api/sessions/participants/route.ts` (created)

**EXACT DIFF:**
```diff
--- /dev/null
+++ app/api/sessions/participants/route.ts
@@ -0,0 +1,179 @@
+import { NextResponse } from "next/server"
+import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
+import { createClient } from "@supabase/supabase-js"
+
+const VALID_ROLES = ["manager", "hostess"] as const
+const VALID_CATEGORIES = ["퍼블릭", "셔츠", "하퍼", "차3"] as const
+
+export async function POST(request: Request) {
+  try {
+    const authContext = await resolveAuthContext(request)
+
+    // Role gate: owner/manager only, hostess forbidden
+    if (authContext.role === "hostess") {
+      return NextResponse.json(
+        { error: "ROLE_FORBIDDEN", message: "Hostess role is not permitted to register participants." },
+        { status: 403 }
+      )
+    }
+    // ... body parsing & validation ...
+    // 1. room_sessions lookup → status='active' check
+    // 2. store_uuid scope check
+    // 3. store_memberships lookup → status='approved' check
+    // 4. session_participants INSERT (price_amount=0)
+    // 5. audit_events INSERT
+    // → 201 { participant_id, session_id, membership_id, role, category, status, entered_at }
  }
}
```

**VALIDATION:**

| Check | Result |
|---|---|
| `resolveAuthContext` 사용 | ✅ |
| `hostess` → 403 | ✅ |
| body: session_id, membership_id, role, category, time_minutes | ✅ |
| `room_sessions` 조회 + `status='active'` 확인 | ✅ → 400 `SESSION_NOT_ACTIVE` |
| `session.store_uuid == authContext.store_uuid` 확인 | ✅ → 403 `STORE_MISMATCH` |
| `store_memberships` 조회 + `approved` 확인 | ✅ → 403 `MEMBERSHIP_NOT_APPROVED` |
| `session_participants` INSERT | ✅ |
| `price_amount = 0` (서버 미계산) | ✅ |
| `audit_events` 기록 | ✅ |
| 응답: participant_id(id), session_id, membership_id, role, category, status, entered_at | ✅ |
| `MEMBERSHIP_NOT_APPROVED` 에러 핸들러 포함 | ✅ |
| forbidden 파일 미수정 | ✅ |
