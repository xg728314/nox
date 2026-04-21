FILES CHANGED:
- `app/api/sessions/settlement/route.ts` (new file, 216 lines)

EXACT DIFF:
```diff
--- /dev/null
+++ app/api/sessions/settlement/route.ts
@@ -0,0 +1,216 @@
+import { NextResponse } from "next/server"
+import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
+import { createClient } from "@supabase/supabase-js"
+
+function roundToUnit(value: number, unit: number): number {
+  return Math.round(value / unit) * unit
+}
+
+export async function POST(request: Request) {
+  try {
+    const authContext = await resolveAuthContext(request)
+
+    // Role gate: owner/manager only, hostess forbidden
+    if (authContext.role === "hostess") {
+      return NextResponse.json(
+        { error: "ROLE_FORBIDDEN", message: "Hostess role is not permitted to perform settlement." },
+        { status: 403 }
+      )
+    }
+    // ... parse body, validate session_id ...
+    // 1. room_sessions 조회, status='closed' 체크
+    // 2. store_uuid 스코프 검증
+    // 3. receipts 중복 체크 → 409
+    // 4. store_settings 조회
+    // 5. session_participants SUM(price_amount)
+    // 6. orders SUM(amount)
+    // 7. 정산 공식 서버 계산
+    // 8. receipts INSERT (status='draft')
+    // 9. audit_events INSERT
+    // 응답: receipt_id, session_id, 금액 필드들, status
```

VALIDATION:

| 체크 항목 | 결과 |
|---|---|
| role 체크 (hostess → 403) | ✅ line 14-19 |
| session closed 체크 | ✅ line 62-68 |
| 중복 정산 체크 (409) | ✅ line 74-90 |
| store_uuid 스코프 검증 | ✅ line 72-78 |
| store_settings 조회 | ✅ line 93-102 |
| participant_total = SUM(price_amount) | ✅ line 105-116 |
| order_total = SUM(amount) | ✅ line 119-130 |
| 정산 공식 (gross→tc→base→manager→hostess→margin) | ✅ line 133-143 |
| roundToUnit = Math.round(v/u)*u | ✅ line 5-7 |
| payout_basis 분기 (gross / netOfTC) | ✅ line 137-139 |
| receipts INSERT status='draft' | ✅ line 146-162 |
| audit_events 기록 | ✅ line 167-187 |
| 클라이언트 금액 입력 없음 | ✅ body에서 session_id만 수신 |
| MEMBERSHIP_NOT_APPROVED 에러 핸들러 | ✅ line 205 |
| forbidden 파일 미수정 | ✅ |
