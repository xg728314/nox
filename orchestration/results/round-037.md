---

**FILES CHANGED:**
- `app/api/sessions/checkin/route.ts`

**EXACT DIFF:**

```diff
-      .select("id")                          // conflict check
+      .select("session_id")

-      .select("id, status, started_at")      // INSERT return
+      .select("session_id, status, started_at")

-        session_id: session.id,              // audit_events
+        session_id: session.session_id,

-        entity_id: session.id,              // audit_events
+        entity_id: session.session_id,

-        session_id: session.id,             // response
+        session_id: session.session_id,
```

**VALIDATION:**

| Constraint | Status |
|---|---|
| `resolveAuthContext` 사용 | ✓ line 7 |
| hostess → 403 | ✓ lines 10–15 |
| `rooms` store_uuid 일치 확인 | ✓ lines 52–53 |
| active session 중복 → 409 | ✓ lines 63–77 |
| `store_operating_days` business_day 조회 | ✓ lines 84–89 |
| 없으면 자동 생성 | ✓ lines 94–112 |
| `room_sessions` INSERT + `business_day_id` | ✓ lines 115–125 |
| `audit_events` 기록 | ✓ lines 134–152 |
| 응답: session_id, room_uuid, store_uuid, status, started_at | ✓ lines 154–163 |
| forbidden 파일 미수정 | ✓ |

**Root cause of fixes:** `room_sessions` PK is `session_id` (confirmed from `rooms/[room_uuid]/participants/route.ts` which `.select("session_id")` from that table). The prior version was selecting and propagating `id` which doesn't exist as a column — causing null `session_id` in the response and audit events.
