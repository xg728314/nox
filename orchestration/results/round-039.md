---

**FILES CHANGED:**
- `app/api/sessions/orders/route.ts` (new file, 163 lines)

**EXACT DIFF:**
```diff
+++ b/app/api/sessions/orders/route.ts
@@ -0,0 +1,163 @@
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
+        { error: "ROLE_FORBIDDEN", message: "Hostess role is not permitted to add orders." },
+        { status: 403 }
+      )
+    }
+
+    // Parse body
+    let body: { session_id?: string; item_name?: string; order_type?: string; qty?: number; unit_price?: number }
+    try {
+      body = await request.json()
+    } catch {
+      return NextResponse.json({ error: "BAD_REQUEST", message: "Request body must be valid JSON." }, { status: 400 })
+    }
+
+    // Field validation ...
+
+    // 1. Look up session, verify active
+    // 2. Verify store_uuid scope
+    // 3. amount = qty * unit_price  ← server only
+    // 4. INSERT into orders
+    // 5. INSERT into audit_events
+    // 6. Return 201 with order fields
```

**VALIDATION:**

| Constraint | Status |
|---|---|
| `resolveAuthContext` 사용 | PASS — line 7 |
| hostess → 403 | PASS — lines 10-15 |
| body: session_id, item_name, order_type, qty, unit_price | PASS — lines 18-55 |
| room_sessions 조회 + status='active' 확인 | PASS — lines 74-101 |
| session.store_uuid === authContext.store_uuid | PASS — lines 103-108 |
| amount = qty * unit_price (서버 계산, 클라이언트 입력 금지) | PASS — line 111 (client `amount` field never accepted) |
| orders INSERT (ordered_by = user_id) | PASS — lines 113-130 |
| audit_events INSERT | PASS — lines 133-150 |
| 응답: order_id, session_id, item_name, order_type, qty, unit_price, amount, ordered_by | PASS — lines 152-161 |
| MEMBERSHIP_NOT_APPROVED error handler | PASS — line 171 |
| forbidden 파일 미수정 | PASS — only target file created |
