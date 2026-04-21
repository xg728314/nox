---

**FILES CHANGED:**
`app/api/sessions/receipt/route.ts` (new file)

**EXACT DIFF:**
```diff
+++ b/app/api/sessions/receipt/route.ts
@@ -0,0 +1,182 @@
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
+        { error: "ROLE_FORBIDDEN", message: "Hostess role is not permitted to generate receipts." },
+        { status: 403 }
+      )
+    }
+
+    // Parse body
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
+
+    if (!session_id) {
+      return NextResponse.json(
+        { error: "BAD_REQUEST", message: "session_id is required." },
+        { status: 400 }
+      )
+    }
+
+    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
+    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
+
+    if (!supabaseUrl || !supabaseServiceKey) {
+      return NextResponse.json(
+        { error: "SERVER_CONFIG_ERROR", message: "Supabase environment variables are not configured." },
+        { status: 500 }
+      )
+    }
+
+    const supabase = createClient(supabaseUrl, supabaseServiceKey)
+
+    // 1. Look up session, verify store_uuid scope
+    const { data: session, error: sessionError } = await supabase
+      .from("room_sessions")
+      .select("session_id, store_uuid, room_uuid")
+      .eq("session_id", session_id)
+      .maybeSingle()
+
+    if (sessionError || !session) {
+      return NextResponse.json(
+        { error: "SESSION_NOT_FOUND", message: "Session not found." },
+        { status: 404 }
+      )
+    }
+
+    if (session.store_uuid !== authContext.store_uuid) {
+      return NextResponse.json(
+        { error: "STORE_MISMATCH", message: "Session does not belong to your store." },
+        { status: 403 }
+      )
+    }
+
+    // 2. Verify receipt exists (settlement must happen first)
+    const { data: receipt, error: receiptError } = await supabase
+      .from("receipts")
+      .select("id, gross_total, tc_amount, manager_amount, hostess_amount, margin_amount, order_total_amount, participant_total_amount, status")
+      .eq("session_id", session_id)
+      .maybeSingle()
+
+    if (receiptError) {
+      return NextResponse.json(
+        { error: "RECEIPT_FETCH_FAILED", message: "Failed to fetch receipt." },
+        { status: 500 }
+      )
+    }
+
+    if (!receipt) {
+      return NextResponse.json(
+        { error: "RECEIPT_NOT_FOUND", message: "No receipt found for this session. Please complete settlement first." },
+        { status: 400 }
+      )
+    }
+
+    // 3. Fetch session_participants
+    const { data: participants, error: participantsError } = await supabase
+      .from("session_participants")
+      .select("*")
+      .eq("session_id", session_id)
+
+    if (participantsError) {
+      return NextResponse.json(
+        { error: "PARTICIPANTS_FETCH_FAILED", message: "Failed to fetch session participants." },
+        { status: 500 }
+      )
+    }
+
+    // 4. Fetch orders
+    const { data: orders, error: ordersError } = await supabase
+      .from("orders")
+      .select("*")
+      .eq("session_id", session_id)
+
+    if (ordersError) {
+      return NextResponse.json(
+        { error: "ORDERS_FETCH_FAILED", message: "Failed to fetch session orders." },
+        { status: 500 }
+      )
+    }
+
+    const now = new Date().toISOString()
+
+    // 5. Build snapshot JSON
+    const snapshotData = {
+      receipt: {
+        id: receipt.id,
+        gross_total: receipt.gross_total,
+        tc_amount: receipt.tc_amount,
+        manager_amount: receipt.manager_amount,
+        hostess_amount: receipt.hostess_amount,
+        margin_amount: receipt.margin_amount,
+        order_total_amount: receipt.order_total_amount,
+        participant_total_amount: receipt.participant_total_amount,
+        status: receipt.status,
+      },
+      participants: participants ?? [],
+      orders: orders ?? [],
+      created_at: now,
+    }
+
+    // 6. INSERT receipt_snapshots (append-only)
+    const { data: snapshot, error: snapshotInsertError } = await supabase
+      .from("receipt_snapshots")
+      .insert({
+        session_id,
+        store_uuid: authContext.store_uuid,
+        room_uuid: session.room_uuid,
+        receipt_id: receipt.id,
+        snapshot: snapshotData,
+        created_by: authContext.user_id,
+        created_at: now,
+      })
+      .select("id, session_id, store_uuid, room_uuid, created_at")
+      .single()
+
+    if (snapshotInsertError || !snapshot) {
+      return NextResponse.json(
+        { error: "SNAPSHOT_CREATE_FAILED", message: "Failed to create receipt snapshot." },
+        { status: 500 }
+      )
+    }
+
+    // 7. Record audit event
+    await supabase
+      .from("audit_events")
+      .insert({
+        store_uuid: authContext.store_uuid,
+        actor_profile_id: authContext.user_id,
+        actor_role: authContext.role,
+        actor_type: authContext.role,
+        session_id,
+        entity_table: "receipt_snapshots",
+        entity_id: snapshot.id,
+        action: "receipt_snapshot_created",
+        after: {
+          snapshot_id: snapshot.id,
+          receipt_id: receipt.id,
+          session_id,
+          room_uuid: session.room_uuid,
+          store_uuid: authContext.store_uuid,
+          participants_count: (participants ?? []).length,
+          orders_count: (orders ?? []).length,
+          created_at: now,
+        },
+      })
+
+    return NextResponse.json(
+      {
+        snapshot_id: snapshot.id,
+        session_id: snapshot.session_id,
+        room_uuid: snapshot.room_uuid,
+        store_uuid: snapshot.store_uuid,
+        created_at: snapshot.created_at,
+      },
+      { status: 201 }
+    )
+  } catch (error) {
+    if (error instanceof AuthError) {
+      const status =
+        error.type === "AUTH_MISSING" ? 401 :
+        error.type === "AUTH_INVALID" ? 401 :
+        error.type === "MEMBERSHIP_NOT_FOUND" ? 403 :
+        error.type === "MEMBERSHIP_INVALID" ? 403 :
+        error.type === "MEMBERSHIP_NOT_APPROVED" ? 403 :
+        error.type === "SERVER_CONFIG_ERROR" ? 500 :
+        500
+
+      return NextResponse.json(
+        { error: error.type, message: error.message },
+        { status }
+      )
+    }
+
+    return NextResponse.json(
+      { error: "INTERNAL_ERROR", message: "Unexpected error." },
+      { status: 500 }
+    )
+  }
+}
```

**VALIDATION:**

| Constraint | Status |
|---|---|
| `resolveAuthContext` 사용 | PASS — line 8 |
| `hostess` → 403 | PASS — lines 11–18 |
| 요청 body: `session_id` | PASS — lines 20–40 |
| `room_sessions` 조회 + `store_uuid` 확인 | PASS — lines 53–68 |
| `receipts` 없으면 400 | PASS — lines 71–91 |
| `session_participants` 조회 | PASS — lines 93–102 |
| `orders` 조회 | PASS — lines 104–113 |
| snapshot: receipt 데이터 포함 | PASS — lines 118–131 |
| snapshot: participants 배열 포함 | PASS — line 132 |
| snapshot: orders 배열 포함 | PASS — line 133 |
| snapshot: `created_at` timestamp 포함 | PASS — line 134 |
| `receipt_snapshots` INSERT (append-only) | PASS — lines 137–152 |
| `room_uuid` from `room_sessions` | PASS — lines 57, 141 |
| `audit_events` 기록 | PASS — lines 158–178 |
| 응답: `snapshot_id, session_id, room_uuid, store_uuid, created_at` | PASS — lines 180–187 |
| `MEMBERSHIP_NOT_APPROVED` AuthError 처리 | PASS — line 196 |
| forbidden 파일 미수정 | PASS — 단일 파일만 생성 |
