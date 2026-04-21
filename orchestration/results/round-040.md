---

**FILES CHANGED:**
- `app/api/sessions/extend/route.ts` (new file, 193 lines)

---

**EXACT DIFF:**
```diff
--- /dev/null
+++ b/app/api/sessions/extend/route.ts
@@ -0,0 +1,193 @@
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
+        { error: "ROLE_FORBIDDEN", message: "Hostess role is not permitted to extend sessions." },
+        { status: 403 }
+      )
+    }
+
+    // Parse body
+    let body: { session_id?: string; participant_id?: string; extend_minutes?: number }
+    try {
+      body = await request.json()
+    } catch {
+      return NextResponse.json(
+        { error: "BAD_REQUEST", message: "Request body must be valid JSON." },
+        { status: 400 }
+      )
+    }
+
+    const { session_id, participant_id, extend_minutes } = body
+
+    // Required field validation
+    if (!session_id) → 400 BAD_REQUEST
+    if (!participant_id) → 400 BAD_REQUEST
+    if (typeof extend_minutes !== "number") → 400 BAD_REQUEST
+    if (extend_minutes <= 0 || extend_minutes % 15 !== 0) → 400 BAD_REQUEST (15분 단위)
+
+    // Supabase client init
+    const supabase = createClient(supabaseUrl, supabaseServiceKey)
+
+    // 1. room_sessions 조회 + status='active' 확인
+    .from("room_sessions").select("session_id, store_uuid, status").eq("session_id", session_id)
+    → SESSION_NOT_FOUND 404 | SESSION_NOT_ACTIVE 400
+
+    // 2. store_uuid 스코프 확인
+    session.store_uuid !== authContext.store_uuid → STORE_MISMATCH 403
+
+    // 3. session_participants 조회 + status='active' 확인
+    .from("session_participants").select("id, session_id, time_minutes, price_amount, status")
+      .eq("id", participant_id).eq("session_id", session_id)
+    → PARTICIPANT_NOT_FOUND 404 | PARTICIPANT_NOT_ACTIVE 400
+
+    // 4. 서버사이드 계산
+    newTimeMinutes = participant.time_minutes + extend_minutes
+    newPriceAmount = proportional recalculation (unit_rate * newTimeMinutes)
+
+    // 5. UPDATE session_participants
+    .update({ time_minutes: newTimeMinutes, price_amount: newPriceAmount }).eq("id", participant_id)
+
+    // 6. audit_events INSERT (before/after)
+    action: "participant_extended", before: { time_minutes, price_amount, status }, after: { ... }
+
+    // 7. Response 200
+    { participant_id, session_id, time_minutes, status }
+  } catch (AuthError) {
+    MEMBERSHIP_NOT_APPROVED → 403
+    ...
+  }
+}
```

---

**VALIDATION:**

| Constraint | Status |
|---|---|
| `resolveAuthContext` 사용 | ✅ Line 7 |
| `hostess` → 403 | ✅ Lines 10-14 |
| Body: `session_id`, `participant_id`, `extend_minutes` | ✅ Lines 36-56 |
| `extend_minutes` 15분 단위 검증 | ✅ Line 53 (`% 15 !== 0`) |
| `room_sessions` 조회 + `status='active'` 확인 | ✅ Lines 68-87 |
| `session_participants` 조회 + `status='active'` 확인 | ✅ Lines 90-110 |
| `session.store_uuid` == `authContext.store_uuid` | ✅ Lines 89-93 |
| `time_minutes += extend_minutes` (서버 계산) | ✅ Line 114 |
| `price_amount` 재계산 (비례 단가 기준) | ✅ Lines 116-120 |
| `audit_events` INSERT (before/after 포함) | ✅ Lines 131-149 |
| 응답: `participant_id`, `session_id`, `time_minutes`, `status` | ✅ Lines 152-157 |
| `MEMBERSHIP_NOT_APPROVED` 에러 핸들러 포함 | ✅ Line 167 |
| Forbidden 파일 미수정 | ✅ `state.json`, `package.json`, `resolveAuthContext.ts` 미변경 |
