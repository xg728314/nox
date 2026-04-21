You are executing the FINAL NOX validation round.

Ground truth:
- Phase 1–7 structure split is complete
- All core domains are already extracted:
  - settlement
  - orders
  - participants
  - receipt
  - chat
  - cross-store
- All invariants are locked:
  - settlement formula
  - store_uuid scope
  - business day rules
  - API response shapes

This round is NOT refactoring.

This round is:
- simulation
- failure discovery
- integrity validation
- release judgment

---

# OBJECTIVE

Find what breaks under real operating pressure.

Then decide:

👉 Production GO  
👉 Controlled Rollout  
👉 Patch Round Required  

---

# HARD RULES

- DO NOT refactor
- DO NOT redesign
- DO NOT change logic
- DO NOT fix bugs silently
- DO NOT widen scope
- ONLY observe, reproduce, and report

If you find a bug:
- DO NOT fix it
- document it

---

# SCENARIOS TO EXECUTE

Run as many as realistically possible.

---

## 1. CHAT BURST

- rapid messages
- multiple users
- same room concurrency
- read during write

Check:
- last_message correctness
- unread consistency
- ordering

---

## 2. CHECKOUT RACE

Simultaneously:
- checkout
- order mutation
- participant mutation

Check:
- race blocking
- finalized safety
- stale state usage

---

## 3. PARTICIPANT ACTION CHAIN

Run 9 actions sequentially:

- cha3
- banti
- wanti
- category change
- deduction update
- waiter tip
- unspecified fill
- time/price edit
- external name

Check:
- payout correctness
- overwrite conflicts
- audit continuity

---

## 4. SETTLEMENT LOOP

- repeated recalculation
- partial pre-settlement
- edits between calls

Check:
- version increment
- snapshot consistency
- negative remainder guard

---

## 5. RECEIPT LOOP

- repeated generation
- mixed names
- half-ticket cases

Check:
- document consistency
- snapshot upsert
- totals correctness

---

## 6. CROSS-STORE FLOW

- total = 1,200,000
- partial payout
- cancel payout

Check:
- remaining correctness
- attribution correctness

---

## 7. AUTH / SCOPE

Test:
- owner
- manager
- hostess
- other store

Check:
- cross-store access block
- role restriction

---

## 8. BUSINESS DAY EDGE

- before midnight
- after midnight
- before close
- after close

Check:
- day attribution

---

## 9. INVENTORY

- create / update / delete
- insufficient stock

Check:
- decrement
- restore
- mismatch

---

## 10. PEAK LOAD SIMULATION

Combine:

- chat
- orders
- participants
- settlement
- receipt
- cross-store

Focus:
- burst load
- contention
- consistency

---

# BUG REPORT FORMAT

For every issue:

- title
- severity (critical/high/medium/low)
- exact reproduction steps
- expected behavior
- actual behavior
- affected routes/files
- evidence
- likely root cause
- minimal fix candidate

---

# INTEGRITY CHECK (MANDATORY)

Confirm:

- unread consistency
- last_message consistency
- finalized safety
- settlement correctness
- receipt snapshot correctness
- participant payout correctness
- cross-store remaining correctness
- business day correctness
- inventory correctness
- auth/store isolation

---

# JUDGMENT MATRIX

## P0 (BLOCKER)

Any of these = FAIL:

- money mismatch
- finalized mutation allowed
- store scope breach
- business day mismatch
- chat core corruption
- inventory corruption
- reproducible data corruption

---

## P1 (LIMITED ROLLOUT)

- chat unread inconsistencies
- minor ordering delay
- performance degradation
- retry-needed behavior

---

## P2 (SAFE)

- UI/format issues
- minor inefficiencies
- code cleanliness

---

# FINAL OUTPUT

# FINAL SIMULATION REPORT

## 1. SCENARIOS RUN
- list executed scenarios
- list partially executed
- list skipped + reason

## 2. PASS / FAIL SUMMARY
- scenario 1: PASS/FAIL/PARTIAL
- scenario 2: ...
- scenario 10: ...

## 3. BUGS FOUND
(list all)

## 4. INTEGRITY CHECK
(each item PASS/FAIL)

## 5. HOTTEST RISKS
(top 5)

## 6. FIX PRIORITY

### P0
- list

### P1
- list

### P2
- list

## 7. RELEASE JUDGMENT

### FINAL DECISION
- Production GO
or
- Controlled Rollout
or
- Patch Round Required

### REASON
- one paragraph
- must reference actual reproduced results

---

# FINAL RULE

If you cannot prove safety with evidence,
you must NOT declare Production GO.