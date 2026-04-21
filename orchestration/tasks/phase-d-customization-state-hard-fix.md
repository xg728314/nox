# ROUND — PHASE D CUSTOMIZATION STATE PROPAGATION HARD FIX

## OBJECTIVE

Fix the confirmed Phase D customization defect completely and structurally.

This is NOT a cosmetic patch.
This is NOT a "force refresh after save" workaround.
This is NOT a local editor-only fix.

Implement a proper shared client-side preference state propagation model so that:
- room layout changes apply immediately to all live consumers
- sidebar menu changes apply immediately to all live consumers
- reset actions propagate immediately to all live consumers
- failed save does NOT show a false success state
- existing API contract, scope precedence, normalization, manifest safety, and role filtering remain intact

Do this cleanly and minimally, but correctly.

---

## CONFIRMED ROOT CAUSE

The validation already confirmed the real cause:

- `app/counter/hooks/useRoomLayout.ts`
- `app/counter/hooks/useMenuConfig.ts`

Each hook stores preference response in component-local `useState`.

Therefore:
- `RoomLayoutEditor` owns one copy
- `SidebarLayoutEditor` owns one copy
- `RoomCardV2` owns another copy
- `CounterSidebar` owns another copy

Optimistic updates mutate only the caller's hook state.
Sibling consumers keep stale mount-time snapshots until reload/remount.

This must be fixed at the state propagation layer.

---

## REQUIRED SOLUTION DIRECTION

Implement a shared in-memory client-side store with subscriber propagation.

### REQUIRED BEHAVIOR

For room layout:
- one shared store for the preference response
- all hook instances subscribe to that shared store
- first mount loads once
- later hook mounts reuse cached response
- save/reset mutates shared store and broadcasts to all subscribers
- all live consumers re-render immediately without page reload

For sidebar menu:
- same model as room layout
- separate store is acceptable if cleaner

### REQUIRED FAILURE BEHAVIOR

`setLayout`, `resetLayout`, `setConfig`, `resetConfig` must expose real success/failure to callers.

Editors must:
- show success only on actual successful PUT/DELETE
- show failure state/message when save/reset fails
- never show false success if request failed

Do NOT keep the current "swallow error then still say 저장 완료" behavior.

---

## STRICT IMPLEMENTATION RULES

### 1. NO workaround refresh hacks
Forbidden:
- `window.location.reload()`
- router refresh as primary propagation mechanism
- forced remount tricks
- modal close/reopen dependency hacks
- fake timestamp state bumps in unrelated parent components

### 2. NO architecture regression
Do NOT:
- move everything into CounterSidebar local state
- duplicate preference logic inside editors
- bypass hooks and call `/api/me/preferences` directly from modal/editor components
- weaken normalization or role filters

### 3. KEEP CURRENT DOMAIN RULES EXACT
These behaviors must remain unchanged:

#### Scope precedence
- store-specific config overrides global
- global overrides default
- store reset falls back to global
- global reset falls back to default

#### Room layout normalization
- de-dup ids
- remove unknown ids
- hidden only for togglable items

#### Sidebar menu normalization
- only role-allowed ids
- remove unknown ids
- remove duplicates
- hidden only for togglable items

#### Security / role boundary
- UI must not expose forbidden items
- runtime resolution must still re-filter disallowed menu ids
- locked items must remain unhideable/unmovable even with malformed stored payload

---

## PREFERRED FILE STRATEGY

Implement this cleanly via a small shared store module.

Preferred new file:
- `app/counter/hooks/preferencesStore.ts`

Or equivalent small shared helper under:
- `app/counter/hooks/`
- or `lib/counter/`

Use the cleanest minimal structure.

### EXPECTED STORE CAPABILITIES

For each preference domain (room layout / sidebar menu), the shared store should support:
- current response snapshot
- loading state if needed
- in-flight fetch dedupe if needed
- subscribe(listener)
- unsubscribe(listener)
- broadcast()
- mutation helpers for optimistic updates
- rollback or error handling if request fails

You do NOT need a third-party state library.
Do NOT add Zustand/Redux/etc unless absolutely necessary.
Prefer a lightweight module-level store.

---

## REQUIRED CODE CHANGES

### A. Shared store layer
Create a shared module-level preference store for:
- room layout response
- sidebar menu response

Requirements:
- all hook instances read from same source
- first fetch populates shared store
- subsequent hook mounts do not create isolated copies
- successful save/reset updates shared store and broadcasts immediately
- failed save/reset does not commit false final state

### B. `useRoomLayout.ts`
Refactor to use shared store instead of isolated component-only response state.

Must preserve current external behavior/API as much as possible.

Hook must still provide:
- resolved layout
- loading state
- setLayout(...)
- resetLayout(...)

But now with shared propagation.

### C. `useMenuConfig.ts`
Refactor same way.

Hook must still provide:
- resolved menu config
- loading state
- setConfig(...)
- resetConfig(...)

with shared propagation.

### D. Editors
Update:
- `app/counter/components/settings/RoomLayoutEditor.tsx`
- `app/counter/components/settings/SidebarLayoutEditor.tsx`

Required:
- success message only on actual success
- failure message on actual failure
- no false-positive "저장 완료"
- reset should also handle failure honestly

### E. Live consumers
Confirm immediate propagation to:
- `app/counter/components/RoomCardV2.tsx`
- `app/counter/components/CounterSidebar.tsx`

without page reload

---

## REQUIRED VALIDATION AFTER FIX

You must verify all of the following after implementation.

### 1. Immediate live propagation
- open settings
- change room layout order/visibility
- save
- confirm RoomCardV2 updates immediately without reload

- change sidebar menu order/visibility
- save
- confirm CounterSidebar updates immediately without reload

### 2. Reset propagation
- reset room layout
- confirm RoomCardV2 updates immediately without reload
- reset sidebar menu
- confirm CounterSidebar updates immediately without reload

### 3. Scope precedence still correct
- save global
- save store override
- confirm store wins
- reset store
- confirm fallback to global
- reset global
- confirm fallback to default

### 4. Locked protections still intact
- locked room widgets cannot hide/move
- locked `counter` menu cannot hide/move

### 5. Role filter still intact
- forbidden sidebar items remain absent from editor
- malformed stored payload cannot surface forbidden menu item at runtime

### 6. Failure handling
Simulate or inspect failed save path as realistically as possible.
Confirm:
- no false success state
- no permanent client corruption
- reload restores server truth if needed

### 7. Type/build validation
Run:
- `tsc --noEmit`
- `npm run build`

---

## OUTPUT FORMAT

Return ONLY this format:

### 1. FILES CHANGED
- exact list

### 2. ROOT CAUSE
- exact cause fixed
- no speculation

### 3. EXACT FIX SUMMARY
- what changed in store propagation
- what changed in save/reset success handling
- what remained intentionally unchanged

### 4. VALIDATION RESULTS
For each:
- immediate live propagation
- reset propagation
- scope precedence
- locked protections
- role filtering
- failure handling

State PASS / FAIL with exact evidence.

### 5. COMMAND RESULTS
- tsc --noEmit
- npm run build

### 6. REMAINING RISKS
- only real remaining risks
- no vague speculation

---

## CONSTRAINTS

- NO partial workaround
- NO page reload dependency
- NO unrelated refactor
- NO style-only cleanup
- NO broad rewrite
- fix the confirmed structural defect correctly
- preserve all current business and security rules
- prefer smallest correct design, not quickest patch

## STOP CONDITIONS

Report FAIL immediately if any of the following remains true after your changes:
- save still does not propagate immediately to sibling consumers
- reset still does not propagate immediately to sibling consumers
- editor still shows success on failed save/reset
- scope precedence changes incorrectly
- locked items become movable or hideable
- role-disallowed sidebar items can appear at runtime