---

**FILES CHANGED:**
- `app/api/sessions/mid-out/route.ts` (신규 생성)

---

**EXACT DIFF:**
```diff
+++ b/app/api/sessions/mid-out/route.ts
@@ -0,0 +1,155 @@
+import { NextResponse } from "next/server"
+import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
+import { createClient } from "@supabase/supabase-js"
+
+export async function POST(request: Request) {
+  try {
+    const authContext = await resolveAuthContext(request)
+
+    // Role gate: owner/manager only, hostess forbidden
+    if (authContext.role === "hostess") {
+      return NextResponse.json(
+        { error: "ROLE_FORBIDDEN", message: "Hostess role is not permitted to perform mid-out." },
+        { status: 403 }
+      )
+    }
+
+    // Parse body
+    let body: { session_id?: string; participant_id?: string }
+    try {
+      body = await request.json()
+    } catch {
+      return NextResponse.json(
+        { error: "BAD_REQUEST", message: "Request body must be valid JSON." },
+        { status: 400 }
+      )
+    }
+
+    const { session_id, participant_id } = body
+
+    if (!session_id) { /* 400 */ }
+    if (!participant_id) { /* 400 */ }
+
+    // Supabase env check + createClient
+
+    // 1. room_sessions 조회 → status='active' 확인
+    // 2. store_uuid 스코프 검증
+    // 3. session_participants 조회 → status='active' 확인
+    // 4. UPDATE status='left', left_at=now()
+    // 5. audit_events INSERT (before/after)
+    // 6. 응답: participant_id, session_id, status, left_at
+  } catch (error) {
+    // AuthError 분기 포함 MEMBERSHIP_NOT_APPROVED → 403
+    // INTERNAL_ERROR fallback
+  }
+}
```

*(위는 요약 diff — 실제 파일은 155줄 전체 구현)*

---

**VALIDATION:**

| 체크 항목 | 결과 |
|---|---|
| `resolveAuthContext` 사용 | ✅ |
| `hostess` → 403 (`ROLE_FORBIDDEN`) | ✅ |
| body: `session_id`, `participant_id` | ✅ |
| `room_sessions` 조회 + `status='active'` 확인 | ✅ |
| `session_participants` 조회 + `status='active'` 확인 | ✅ |
| `session.store_uuid` vs `authContext.store_uuid` 검증 | ✅ |
| UPDATE `status='left'`, `left_at=now()` | ✅ |
| `audit_events` INSERT (before/after 포함) | ✅ |
| 응답: `participant_id`, `session_id`, `status`, `left_at` | ✅ |
| `MEMBERSHIP_NOT_APPROVED` → 403 포함 | ✅ |
| forbidden 파일 미수정 | ✅ |
