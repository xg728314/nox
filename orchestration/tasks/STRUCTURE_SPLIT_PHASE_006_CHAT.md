You are executing the next locked NOX structure split task.

Use the latest completed execution results as ground truth:
- Phase 1–5 completed successfully
- Core domains extracted:
  - settlement ✔
  - orders ✔
  - participants ✔
  - receipt ✔
- All invariants preserved:
  - auth/store scope
  - settlement semantics
  - response shapes
- validation passed in all prior phases:
  - npx tsc --noEmit
  - npm run build

Do not redo earlier phases.
Continue from the current codebase state only.

---

# CURRENT TASK

Execute ONLY:

PHASE 6 — Chat domain boundary extraction

---

# TARGET

C:\work\nox\app\api\chat\

Expected routes include:
- rooms/route.ts
- messages/route.ts

---

# PRIMARY OBJECTIVE

Separate chat into a proper domain structure:

- message write path
- room membership / visibility
- room list / preview / ordering
- unread / counter handling

Make routes thin controllers.

---

# REQUIRED TARGET STRUCTURE

C:\work\nox\lib\chat\

  services\
    sendMessage.ts
    getRoomList.ts
    getMessages.ts
    updateUnreadState.ts

  queries\
    loadRoomScoped.ts
    loadRoomMembers.ts

  validators\
    validateMessageInput.ts
    validateRoomAccess.ts

  types.ts

---

# HARD RULES

- NO behavior change
- NO message format change
- NO chat visibility rule change
- NO auth/store scope change
- NO API path change
- NO response shape change
- NO schema change
- DO NOT touch session/settlement/orders domains
- DO NOT redesign chat UX
- DO NOT introduce queue system yet
- DO NOT introduce websocket logic
- DO NOT optimize prematurely

---

# REQUIRED EXTRACTION STRATEGY

## 1. sendMessage.ts

Extract message creation flow:

- validate sender
- validate room membership
- insert message
- attach metadata (sender, timestamps)
- return message object

---

## 2. getMessages.ts

Extract message retrieval:

- room scoped
- ordered by time
- limit / pagination if exists

---

## 3. getRoomList.ts

Extract room list logic:

- room membership
- last message preview
- ordering (latest message)
- optional unread count

---

## 4. updateUnreadState.ts

Extract unread / read state logic if present:

- mark read
- count unread
- reset unread

If unread logic is partial or inconsistent:
DO NOT redesign — extract only what exists.

---

## 5. Queries

### loadRoomScoped.ts

- room_uuid + store_uuid validation
- ensure same-store access
- reject cross-store

### loadRoomMembers.ts

- validate membership in room
- ensure user is allowed to see messages

---

## 6. Validators

### validateMessageInput.ts

- message content validation
- empty / length / format rules

### validateRoomAccess.ts

- membership check
- role-based restrictions

---

# ROUTE END STATE

routes must only contain:

- request parse
- auth / role guard
- call validator
- call service
- return response

NO business logic inside route.

---

# IMPORTANT CONSTRAINTS

## DO NOT TOUCH

- message schema
- message content structure
- room structure
- membership rules
- existing ordering logic

---

## DO NOT ADD

- caching
- batching
- async queue
- websocket
- pub/sub

👉 이건 PHASE 8 이후

---

## DO NOT FIX BUGS

If you see bug:
- preserve it
- report it
- DO NOT change behavior

---

# VALIDATION REQUIRED

Before final response:

- npm run tsc --noEmit
- npm run build

---

# OUTPUT FORMAT

# ROUND XXX — STRUCTURE SPLIT PHASE 6 REPORT

## 1. FILES CHANGED
- [file path]

## 2. EXTRACTION SUMMARY
- what logic moved to sendMessage.ts
- what logic moved to getMessages.ts
- what logic moved to getRoomList.ts
- what logic moved to updateUnreadState.ts
- what remained in routes

## 3. SAFETY CHECK
- message format untouched: YES/NO
- room visibility unchanged: YES/NO
- auth/store scope unchanged: YES/NO
- response shape unchanged: YES/NO

## 4. VALIDATION
- tsc --noEmit: PASS/FAIL
- build: PASS/FAIL

## 5. ROUTE SIZE IMPACT
- rooms/route.ts before → after
- messages/route.ts before → after

## 6. REMAINING HOTSPOTS
- chat-specific risks
- concurrency risks
- unread inconsistencies

## 7. NEXT RECOMMENDED STEP
- Phase 7 only