# PHASE D VALIDATION — COUNTER CUSTOMIZATION UI

## OBJECTIVE

Validate the newly completed counter customization UI end-to-end using ONLY the implemented Phase C / Phase D behavior.

Do NOT redesign.
Do NOT refactor.
Do NOT add new features unless a validation failure proves a missing safeguard is required.

This task is validation-first.

---

## VALIDATION TARGETS

### 1. Room layout customization
Files expected in scope:
- app/counter/components/settings/ScopeSelector.tsx
- app/counter/components/settings/DragReorderList.tsx
- app/counter/components/settings/RoomLayoutEditor.tsx
- app/counter/components/settings/CounterSettingsModal.tsx

### 2. Sidebar menu customization
Files expected in scope:
- app/counter/components/settings/SidebarLayoutEditor.tsx
- app/counter/components/settings/CounterSettingsModal.tsx
- app/counter/components/CounterSidebar.tsx

### 3. Existing hooks / preferences flow
Validate behavior through already implemented hooks and route only:
- useRoomLayout(storeUuid)
- useMenuConfig(role, storeUuid)
- /api/me/preferences

Do NOT replace this architecture.

---

## REQUIRED VALIDATION SCENARIOS

### A. SETTINGS ENTRY / MODAL

1. Confirm the ⚙ settings button appears in CounterSidebar.
2. Confirm clicking it opens CounterSettingsModal.
3. Confirm modal contains exactly two tabs:
   - 방 레이아웃
   - 사이드바 메뉴
4. Confirm modal close works reliably.

FAIL if:
- settings button missing
- modal does not open
- tab rendering broken
- close action leaves stale overlay/focus lock

---

### B. ROOM LAYOUT EDITOR

Validate all of the following:

1. Scope selector renders correctly.
2. If storeUuid exists:
   - "이 매장만" selectable
   - "전체 적용" selectable
3. If storeUuid is null:
   - "이 매장만" disabled
   - "전체 적용" only usable option
4. All required locked room widgets are present and protected:
   - header_collapsed
   - header_expanded
   - empty_room_panel
   - selection_bar
   - action_row
   - participant_list
   - totals_checkout
5. Locked items must:
   - show locked state
   - not be draggable
   - not allow hide toggle
6. Non-locked items must support:
   - reorder
   - visibility toggle
7. Reorder must work through:
   - drag/drop
   - up/down buttons
8. Reset must restore DEFAULT_ROOM_LAYOUT preview immediately.
9. Save must persist and reflect on next render.

FAIL if:
- locked item can move/hide
- duplicate items appear
- undefined ids survive normalization
- reset does not restore default preview
- save does not visibly apply updated layout

---

### C. SIDEBAR MENU EDITOR

Validate all of the following:

1. Scope selector behavior matches room layout editor.
2. Only role-allowed menu items appear for editing.
3. Locked item "counter" is always present and protected.
4. Locked menu item must:
   - show locked state
   - not be draggable
   - not allow hide
5. Non-locked menu items must support:
   - reorder
   - visibility toggle
6. Reorder must work through:
   - drag/drop
   - up/down buttons
7. Reset must restore DEFAULT_SIDEBAR_MENU preview immediately.
8. Save must persist and reflect in CounterSidebar.

FAIL if:
- forbidden role menu appears
- locked menu can be hidden/moved
- order contains role-disallowed ids
- reset/save does not reflect immediately

---

### D. SCOPE PRECEDENCE / PREFERENCE RESOLUTION

Validate actual resolution behavior, not assumptions.

Required checks:

1. Save GLOBAL room layout customization.
2. Save STORE room layout customization with different order/visibility.
3. Confirm STORE view resolves STORE config over GLOBAL.
4. Reset STORE config only.
5. Confirm effective layout falls back to GLOBAL config.
6. Reset GLOBAL config.
7. Confirm effective layout falls back to DEFAULT.

Repeat same sequence for sidebar menu.

FAIL if:
- scope precedence is reversed
- reset does not fall back correctly
- stale local state masks actual server result

---

### E. PERSISTENCE / RELOAD

Validate persistence across runtime boundaries:

1. Save customization.
2. Refresh page.
3. Navigate away and back.
4. Close modal and reopen.
5. Full logout/login if auth flow is available.
6. Confirm saved state reloads correctly from preferences source of truth.

FAIL if:
- optimistic state works but reload loses changes
- reopened modal shows stale draft inconsistent with actual applied config
- store/global selection reloads wrong source

---

### F. TOUCH / NON-DRAG ENVIRONMENT

Assume HTML5 draggable may fail on some touch devices.

Validate:
1. Up/down controls alone can fully reorder unlocked items.
2. First item disables up.
3. Last item disables down.
4. Locked rows cannot be shifted indirectly by button logic in a way that violates protection.
5. No broken ordering after repeated button moves.

FAIL if:
- touch fallback is insufficient
- button reorder bypasses lock semantics
- ordering becomes unstable after repeated moves

---

### G. ERROR / FAILURE BEHAVIOR

Current architecture says optimistic update happens immediately and PUT failure is not surfaced except eventual GET recovery.

Validate actual behavior:

1. Simulate or inspect failed save path if possible.
2. Confirm UI does not corrupt draft irreversibly.
3. Confirm subsequent reload restores server truth.
4. Document exact UX problem if save failure is silent.

Do NOT redesign unless failure is confirmed.
If confirmed, report exact minimal fix.

FAIL if:
- failed save leaves permanently broken client state
- server truth cannot recover on reload

---

### H. NORMALIZATION / MANIFEST SAFETY

Validate save normalization behavior:

#### Room editor
- de-dup works
- undefined ids removed
- hidden keeps only togglable ids

#### Sidebar editor
- role-disallowed ids removed
- unknown ids removed
- hidden keeps only togglable ids

Also validate behavior when:
- order is partial
- order has duplicates
- hidden includes locked item ids

FAIL if:
- malformed saved shape survives into runtime
- locked/forbidden items persist after normalization
- runtime render crashes on invalid config

---

### I. SECURITY / ROLE BOUNDARY

Validate that customization cannot be used to bypass authorization.

Required checks:

1. Sidebar editor only exposes role-allowed menu ids.
2. If a disallowed id is manually inserted into saved payload or local state, runtime resolution must filter it out.
3. Locked item protections cannot be bypassed through local edits.
4. Store/global scope must not allow cross-store leakage.

FAIL if:
- role-disallowed menu can appear
- manual payload manipulation survives runtime filter
- store_uuid scoping is bypassed

---

## REQUIRED COMMAND VALIDATION

Run and report exact result:

- tsc --noEmit
- npm run build

If runtime/manual validation is performed, report exact route/page entry path and exact observed result.

---

## OUTPUT FORMAT

Return ONLY this format:

### 1. VALIDATION RESULT
- PASS / FAIL
- Overall judgment in 3~6 lines

### 2. SCENARIO RESULTS
For each section A~I:
- PASS / FAIL
- Exact evidence
- Exact failure point if any

### 3. FILES TOUCHED
- List files changed during validation fix
- If no code changes were needed, explicitly say "No files changed"

### 4. ROOT CAUSE
- Only if failure found
- Explain exact cause, not guesses

### 5. EXACT FIX SUMMARY
- Only if failure found
- Precise behavior-level summary

### 6. COMMAND RESULTS
- tsc --noEmit
- npm run build

### 7. REMAINING RISKS
- Only real residual risks after validation
- No vague speculation

---

## CONSTRAINTS

- NO speculative claims
- NO architecture rewrite
- NO unrelated cleanup
- NO style-only edits
- Prefer validation and evidence over code changes
- If runtime validation cannot be completed, explicitly say exactly what was and was not verified

---

## STOP CONDITIONS

Stop immediately and report FAIL if any of the following is true:
- locked item can be hidden or reordered
- store/global precedence is wrong
- saved customization does not survive reload
- role-disallowed sidebar item becomes visible
- invalid saved payload can break runtime render