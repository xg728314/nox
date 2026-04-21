# STEP-NEXT — FLOOR5 10-DAY HEAVY OPERATION SIMULATION

[STEP ID]
STEP-NEXT-FLOOR5-10DAY-HEAVY-SIM

[TASK TYPE]
controlled simulation + validation

[OBJECTIVE]
Re-run the floor-5 operation simulation at significantly higher volume using the actual live path, after settlement formula relock/backfill readiness.

This simulation must exercise the real operational system under heavier realistic conditions.

This step must include:
- account lifecycle (signup / approval / login)
- manager-to-manager chat
- room/session operations
- hostess assignment and movement
- customer creation and repeat customers
- liquor/inventory usage
- settlement lifecycle
- cross-store work and settlement
- audit logging
- security boundaries
- operational edge cases

This is NOT design-only.
This is NOT dormant-system work.

Use only the live operational path.

---

[PRECONDITION]

Before meaningful execution:
- legacy draft receipts should be backfilled or clearly isolated
- do NOT run the heavy simulation on top of known-bad legacy settlement rows without stating that fact

If backfill is incomplete:
- report that explicitly
- continue only with isolated simulation fixtures / safe new data

---

[LIVE PATH ONLY]

Use System A only:

- app/api/sessions/settlement/route.ts
- app/api/sessions/settlement/finalize/route.ts
- receipts / pre_settlements / session flow
- actual chat/session/order/store/account APIs currently used by UI

DO NOT use dormant normalized settlement infrastructure.

FAIL IF:
- System B is used
- dormant routes are wired into the simulation

---

[EXPANDED FIXED MODEL]

Target stores:
- 마블
- 버닝
- 황진이
- 라이브

Per store:
- managers: 4
- hostesses: 50
  - public: 17
  - shirt: 17
  - hyper: 16

Total:
- managers: 16
- hostesses: 200

Customers:
- 12 to 16 teams per store per day
- 4 stores × (12~16) teams/day
- 10 days total

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

Customer composition:
- repeat customers
- 신규 customers
- no-show / short-play / full-time / half-time / correction cases

---

[ACCOUNT LIFECYCLE SIMULATION]

The simulation MUST include real account lifecycle flows.

### Manager accounts
Per store:
- simulate manager signup
- simulate pending -> approved
- simulate login
- simulate operational usage after approval

### Hostess accounts
Per store:
- simulate hostess signup
- assign category (public/shirt/hyper)
- pending -> approved
- manager assignment
- store membership verification
- login where applicable

### During 10-day run
Must include:
- 신규 hostess joins
- 신규 manager joins
- delayed approvals
- rejected account cases
- suspended / blocked cases only if already supported by live path

Validate:
- only approved accounts can operate
- pending accounts blocked
- rejected accounts blocked
- correct store_uuid scope applies

---

[REQUIRED REAL-WORLD EVENTS]

The simulation MUST include realistic randomized operation events:

1. manager-to-manager chat
2. hostess recommendation / choice / shortage ("빵꾸") messages
3. cross-store hostess dispatch
4. 신규 hostess registration
5. hostess transfer between stores (example: 라이브 -> 황진이)
6. 신규 customer creation
7. repeat customer returns
8. liquor ordering
9. low-stock / no-stock situations
10. settlement corrections:
   - full-time -> half-time
   - pending correction
   - mismatch correction after expectation change
11. mid-out
12. extend
13. checkout
14. finalize
15. business-day close

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
- no unauthorized visibility

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
- blocked invalid settlement path if triggered
- relocked formula interpretation:
  - customer_total
  - participant_flow_total
  - manager_profit_total
  - hostess_profit_total
  - store_revenue_total
  - store_profit_total

---

[SECURITY / SCOPE VALIDATION]

Validate:
- store_uuid isolation
- manager cannot see unauthorized data
- hostess data visibility remains scoped
- cross-store access occurs only through intended operation paths
- chat scope does not leak between unrelated actors
- pending/rejected users cannot operate

---

[EXECUTION STRATEGY]

Run in three phases:

Phase 1:
- 1-day dry run with heavy model

Phase 2:
- 3-day validation run

Phase 3:
- 10-day full run

If a severe blocker appears in Phase 1 or Phase 2:
- report it clearly
- stop before fabricating volume results

---

[VALIDATION OUTPUT REQUIRED]

Must report all of the following:

1. total stores / managers / hostesses / customers simulated
2. total signups / approvals / logins
3. total sessions created
4. total chat messages created
5. total orders created
6. total cross-store assignments
7. total transfers
8. total settlement corrections
9. total finalize events
10. total business-day closes
11. failures by category

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

[STRICT RULES]

- do not redesign formulas
- do not touch dormant settlement system
- do not expand into unrelated features
- use actual live-path APIs and flows
- keep simulation data isolated from real business data
- no guessing in result classification

---

[OUTPUT FORMAT]

Respond with exactly:

1. SIMULATION FIXTURE SUMMARY
2. PHASE RESULTS
3. ACCOUNT / CHAT / SESSION / SETTLEMENT VALIDATION
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

STOP after the 10-day heavy operation simulation and validation summary is complete.

This step is FLOOR-5 HEAVY FULL OPERATION SIMULATION ONLY.