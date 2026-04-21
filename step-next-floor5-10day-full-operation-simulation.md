# STEP-NEXT — FLOOR5 10-DAY FULL OPERATION SIMULATION

[STEP ID]
STEP-NEXT-FLOOR5-10DAY-SIM

[TASK TYPE]
controlled simulation + validation

[OBJECTIVE]
Simulate 10 days of realistic floor-5 operations using the actual live-path system and validate all major operational features under mixed real-world conditions.
[ACCOUNT LIFECYCLE SIMULATION]

Must include:

1. manager signup flow
   - create manager accounts per store
   - status pending → approved
   - login verification

2. hostess signup flow
   - create 30 hostesses per store
   - assign category (public/shirt/hyper)
   - pending → approved
   - manager assignment

3. new account creation during simulation
   - new hostess joins mid-simulation
   - new manager joins mid-simulation
   - delayed approval cases
   - rejected account cases

4. cross-store movement
   - hostess moves from one store to another
   - validate:
     - store_membership update
     - primary manager reassignment
     - existing records remain valid

5. validation
   - only approved accounts can operate
   - pending accounts blocked from all APIs
   - rejected accounts blocked
   - correct store_uuid scoping enforced
This step must exercise:
- room/session operations
- hostess assignment and movement
- manager-to-manager chat usage
- customer flow
- liquor/inventory usage
- settlement lifecycle
- cross-store work and settlement
- audit logging
- security boundaries
- operational edge cases

This is NOT a design-only task.
This is NOT a UI polish task.
This is NOT a dormant-system task.

Use only the live operational path.

---

[LIVE PATH ONLY]

Use System A only:

- app/api/sessions/settlement/route.ts
- app/api/sessions/settlement/finalize/route.ts
- receipts / pre_settlements / session flow
- actual chat/session/order/store APIs currently used by UI

DO NOT use dormant normalized settlement infrastructure.

FAIL IF:
- System B is used
- dormant routes are wired into the simulation

---

[FLOOR-5 FIXED MODEL]

Stores:
- 마블
- 버닝
- 황진이
- 라이브

Per store:
- managers: 4
- hostesses: 30
  - public: 10
  - shirt: 10
  - hyper: 10

Total:
- managers: 16
- hostesses: 120

Customers:
- 8 teams per store per day
- 4 stores × 8 teams = 32 teams/day
- 10 days = 320 teams total baseline

Customer behavior:
- average 4 rounds
- random category mix:
  - public only
  - shirt only
  - hyper only
  - public+shirt
  - shirt+hyper
  - public+hyper
  - public+shirt+hyper

---

[REQUIRED REAL-WORLD EVENTS]

The simulation MUST include realistic randomized operation events:

1. manager-to-manager chat
2. hostess recommendation / choice / shortage ("빵꾸") messages
3. cross-store hostess dispatch
4. 신규 hostess registration
5. hostess transfer between stores (example: 라이브 -> 황진이)
6. 신규 customer creation
7. liquor ordering
8. low-stock / no-stock situations
9. settlement corrections:
   - full-time -> half-time
   - pending correction
   - adjustment after expectation mismatch
10. mid-out
11. extend
12. checkout
13. finalize
14. business-day close

---

[CHAT SIMULATION]

Must simulate actual manager chat usage patterns such as:

- "마블 손님 3명 퍼블릭 초이스 있습니다"
- "버닝 셔츠 3인 초이스 있습니다"
- "황진이 퍼블릭 2인 1빵꾸"
- "라이브 셔츠 대기 있습니다"
- "다른 가게 대기자 보낼게요"

Validate:
- chat visibility scope
- message persistence
- room/channel usage
- message ordering
- unread/update behavior if applicable

FAIL IF:
- chat does not persist correctly
- unauthorized visibility appears

---

[SETTLEMENT SIMULATION]

Must include:
- public / shirt / hyper pricing
- cha3 boundary
- shirt greeting exception
- full-time to half-time correction
- finalize-before/after correction handling
- cross-store store-level payable
- pre-settlement
- remainder tracking
- blocked negative remainder path if triggered

---

[SECURITY / SCOPE VALIDATION]

Validate:
- store_uuid isolation
- manager cannot see unauthorized data
- hostess data visibility remains scoped
- cross-store access occurs only through intended operation paths
- chat scope is not leaking between unrelated actors

---

[VALIDATION OUTPUT REQUIRED]

Must report all of the following:

1. total stores / managers / hostesses / customers simulated
2. total sessions created
3. total chat messages created
4. total orders created
5. total cross-store assignments
6. total transfers
7. total settlement corrections
8. total finalize events
9. total business-day closes
10. failures by category

For each failure:
- scenario id
- subsystem
- expected
- actual
- root cause
- severity

---

[REQUIRED ANALYSIS]

At the end, classify findings into exactly these buckets:

1. CRITICAL PROBLEMS
2. SECURITY RISKS
3. OPERATIONAL PAIN POINTS
4. DATA CONSISTENCY RISKS
5. FEATURES TO ADD
6. SAFE FOR CURRENT OPERATION

---

[EXECUTION STRATEGY]

Run in three phases:

Phase 1:
- 1-day dry run

Phase 2:
- 3-day validation run

Phase 3:
- 10-day full run

If a severe blocker appears in Phase 1 or Phase 2, report it clearly before continuing or explain how it was isolated.

---

[STRICT RULES]

- do not redesign formulas
- do not touch dormant settlement system
- do not expand into unrelated features
- use actual live-path APIs and flows
- keep test/sim data isolated from real business data
- no guessing in result classification

---

[OUTPUT FORMAT]

Respond with exactly:

1. SIMULATION FIXTURE SUMMARY
2. PHASE RESULTS
3. CHAT / SESSION / SETTLEMENT VALIDATION
4. CROSS-STORE / TRANSFER VALIDATION
5. SECURITY / SCOPE VALIDATION
6. CRITICAL PROBLEMS
7. SECURITY RISKS
8. OPERATIONAL PAIN POINTS
9. DATA CONSISTENCY RISKS
10. FEATURES TO ADD
11. SAFE FOR CURRENT OPERATION
12. FINAL JUDGMENT

---

[STOP CONDITIONS]

STOP after the 10-day operation simulation and validation summary is complete.

This step is FLOOR-5 FULL OPERATION SIMULATION ONLY.