All changes confirmed. Here is the complete report:

---

## FILES CHANGED

- `app/api/rooms/route.ts`
- `app/api/rooms/[room_uuid]/route.ts`
- `app/api/rooms/[room_uuid]/participants/route.ts`
- `app/api/store/profile/route.ts`
- `app/api/store/settlement/overview/route.ts`
- `app/api/manager/dashboard/route.ts`
- `app/api/manager/hostesses/route.ts`
- `app/api/manager/hostesses/[hostess_id]/route.ts`
- `app/api/manager/settlement/summary/route.ts`
- `app/api/me/dashboard/route.ts`
- `app/api/me/sessions/route.ts`
- `app/api/me/sessions/[session_id]/route.ts`
- `app/api/me/settlement-status/route.ts`

---

## EXACT DIFF (per file)

**`rooms/route.ts`**
- `.select("room_uuid, room_no, room_name, status")` → `.select("id, room_no, room_name, is_active")`
- error handler: `MEMBERSHIP_NOT_APPROVED ? 403` added

**`rooms/[room_uuid]/route.ts`**
- `.select("room_uuid, room_no, room_name, status, created_at")` → `.select("id, room_no, room_name, is_active, created_at")`
- `.eq("room_uuid", roomUuid)` → `.eq("id", roomUuid)`
- response: `room_uuid: room.room_uuid` → `room_uuid: room.id`, `status: room.status` → `is_active: room.is_active`
- error handler: `MEMBERSHIP_NOT_APPROVED ? 403` added

**`rooms/[room_uuid]/participants/route.ts`**
- rooms query: `.select("room_uuid")` → `.select("id")`, `.eq("room_uuid", roomUuid)` → `.eq("id", roomUuid)`
- `from("sessions")` → `from("room_sessions")`, `.eq("room_uuid", roomUuid)` → `.eq("room_id", roomUuid)`, `.eq("session_status", "active")` → `.eq("status", "active")`
- participants select: `participant_type, participant_status, joined_at` → `role, status, entered_at`; `.order("joined_at")` → `.order("entered_at")`
- error handler: `MEMBERSHIP_NOT_APPROVED ? 403` added

**`store/profile/route.ts`**
- `.select("store_uuid, store_name, created_at")` → `.select("id, store_name, created_at")`
- `.eq("store_uuid", authContext.store_uuid)` → `.eq("id", authContext.store_uuid)`
- response: `store_uuid: store.store_uuid` → `store_uuid: store.id`
- error handler: `MEMBERSHIP_NOT_APPROVED ? 403` added

**`store/settlement/overview/route.ts`**
- `.order("joined_at")` → `.order("entered_at")`
- `from("settlements")` → `from("receipts")`
- error handler: `MEMBERSHIP_NOT_APPROVED ? 403` added

**`manager/dashboard/route.ts`**
- `from("manager_hostess_assignments")` → `from("hostesses")`
- `.eq("manager_membership_id", authContext.user_id)` → `.eq("manager_membership_id", authContext.membership_id)`
- `users!inner(display_name)` → `profiles!inner(full_name)`, `h.users.display_name` → `h.profiles.full_name`
- error handler: `MEMBERSHIP_NOT_APPROVED ? 403` added

**`manager/hostesses/route.ts`**
- `from("manager_hostess_assignments")` → `from("hostesses")`
- `.eq("manager_membership_id", authContext.user_id)` → `.eq("manager_membership_id", authContext.membership_id)`
- `users!inner(display_name)` → `profiles!inner(full_name)`, `h.users.display_name` → `h.profiles.full_name`
- error handler: `MEMBERSHIP_NOT_APPROVED ? 403` added

**`manager/hostesses/[hostess_id]/route.ts`**
- `from("manager_hostess_assignments")` → `from("hostesses")`
- `.eq("manager_membership_id", authContext.user_id)` → `.eq("manager_membership_id", authContext.membership_id)`
- `users!inner(display_name)` → `profiles!inner(full_name)`, `(hostess as any).users.display_name` → `(hostess as any).profiles.full_name`
- error handler: `MEMBERSHIP_NOT_APPROVED ? 403` added

**`manager/settlement/summary/route.ts`**
- `from("manager_hostess_assignments")` → `from("hostesses")`
- `.eq("manager_membership_id", authContext.user_id)` → `.eq("manager_membership_id", authContext.membership_id)`
- `.order("joined_at")` → `.order("entered_at")`
- `from("settlements")` → `from("receipts")`
- error handler: `MEMBERSHIP_NOT_APPROVED ? 403` added

**`me/dashboard/route.ts`**
- `sessions!inner(session_status)` → `room_sessions!inner(status)`
- `.eq("membership_id", authContext.user_id)` → `.eq("membership_id", authContext.membership_id)`
- `.eq("participant_status", "active")` → `.eq("status", "active")`
- `.eq("sessions.session_status", "active")` → `.eq("room_sessions.status", "active")`
- error handler: `MEMBERSHIP_NOT_APPROVED ? 403` added

**`me/sessions/route.ts`**
- `select("session_id, participant_status, sessions!inner(session_status)")` → `select("session_id, status, room_sessions!inner(status)")`
- `.eq("membership_id", authContext.user_id)` → `.eq("membership_id", authContext.membership_id)`
- `.order("joined_at")` → `.order("entered_at")`
- response map: `p.participant_status` → `p.status`, `p.sessions.session_status` → `p.room_sessions.status`
- error handler: `MEMBERSHIP_NOT_APPROVED ? 403` added

**`me/sessions/[session_id]/route.ts`**
- `select("session_id, participant_status, sessions!inner(session_status)")` → `select("session_id, status, room_sessions!inner(status)")`
- `.eq("membership_id", authContext.user_id)` → `.eq("membership_id", authContext.membership_id)`
- response: `participation.participant_status` → `participation.status`, `.sessions.session_status` → `.room_sessions.status`
- error handler: `MEMBERSHIP_NOT_APPROVED ? 403` added

**`me/settlement-status/route.ts`**
- `select("session_id, sessions!inner(session_id, settlements(status))")` → `select("session_id, room_sessions!inner(session_id, receipts(status))")`
- `.eq("membership_id", authContext.user_id)` → `.eq("membership_id", authContext.membership_id)`
- `.order("joined_at")` → `.order("entered_at")`
- `(participation as any).sessions` → `(participation as any).room_sessions`, `sessions?.settlements` → `sessions?.receipts`
- error handler: `MEMBERSHIP_NOT_APPROVED ? 403` added

---

## VALIDATION

| # | 수정 기준 | 결과 |
|---|-----------|------|
| 1 | `sessions` → `room_sessions` | **PASS** — participants, me/dashboard, me/sessions, me/sessions/[id], me/settlement-status |
| 2 | `session_status` → `status` | **PASS** — all `session_status` references replaced with `status` |
| 3 | `manager_hostess_assignments` → `hostesses` (manager_membership_id 기준) | **PASS** — dashboard, hostesses, hostesses/[id], settlement/summary |
| 4 | `rooms.room_uuid` → `rooms.id` | **PASS** — select 및 eq 필터 모두 교체 |
| 5 | `rooms.status` → `rooms.is_active` | **PASS** — rooms/route, rooms/[room_uuid]/route 응답 포함 |
| 6 | `participant_type` → `role` | **PASS** — participants/route.ts select 교체 |
| 7 | `participant_status` → `status` | **PASS** — participants select, me/dashboard eq, me/sessions, me/sessions/[id] |
| 8 | `joined_at` → `entered_at` | **PASS** — 모든 order 및 select에서 교체 |
| 9 | `settlements` → `receipts` | **PASS** — store/settlement/overview, manager/settlement/summary, me/settlement-status |
| 10 | `users` → `profiles`, `display_name` → `full_name` | **PASS** — manager/dashboard, manager/hostesses, manager/hostesses/[id] |
| 11 | `authContext.user_id` → `authContext.membership_id` | **PASS** — 8개 파일 전체 적용 |
| 12 | 모든 에러 핸들러에 `MEMBERSHIP_NOT_APPROVED` 추가 | **PASS** — 13개 파일 전체 |
| 13 | `store/profile`: store PK는 `id` | **PASS** — select `id`, `.eq("id", ...)`, 응답 `store.id` |
