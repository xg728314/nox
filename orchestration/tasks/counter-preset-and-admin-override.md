# ROUND — COUNTER PRESET SYSTEM + ADMIN FORCED OVERRIDE DESIGN/FIX

## OBJECTIVE

Implement the next two layers on top of the completed counter customization system:

1. Preset system
2. Admin forced override system

BLE work is deferred.
Do NOT touch BLE in this round.

This round must build on the existing completed shared preference propagation model.
Do NOT replace the current user preference architecture.
Do NOT remove current customization behavior.

---

## PHASE 1 — PRESET SYSTEM

### GOAL

Allow users to apply predefined room-layout and sidebar-menu presets instead of manually configuring every item.

Presets must work on top of the current draft/edit/save flow.

### REQUIRED BEHAVIOR

For room layout:
- define named presets
- each preset provides order + hidden config
- user can select a preset inside the existing settings UI
- applying a preset updates the current editor draft immediately
- final persistence still uses existing setLayout / resetLayout flow

For sidebar menu:
- same behavior
- preset must still respect role filtering and locked items

### REQUIRED RULES

- locked items must remain unhideable/unmovable
- unknown ids must be ignored
- room preset normalization must still pass through existing order/hidden normalization
- sidebar preset normalization must still pass through role filtering and togglable filtering
- applying a preset must NOT save automatically unless explicitly saved by the user
- reset-to-default behavior must remain separate from preset apply

### UI REQUIREMENTS

Inside CounterSettingsModal:
- allow preset selection in RoomLayoutEditor
- allow preset selection in SidebarLayoutEditor
- preset apply should be obvious and fast
- current save/reset flow must remain

You may add:
- dropdown
- segmented buttons
- quick apply buttons

Choose the smallest clean UI.

---

## PHASE 2 — ADMIN FORCED OVERRIDE

### GOAL

Allow admin/owner-level configuration to forcibly define the effective counter layout/menu for:
- specific store
- global scope

This must be a higher-priority layer than user preferences.

### REQUIRED PRECEDENCE

Effective resolution must become:

1. forced store override
2. forced global override
3. user store config
4. user global config
5. default

This precedence must be exact.

### REQUIRED SECURITY

- only authorized admin/owner/top-admin roles can create/update/delete forced overrides
- non-admin users must never edit forced overrides
- non-admin users may still have personal preferences, but forced overrides must win at runtime
- role-disallowed sidebar items must still never render, even inside forced config
- locked items must still remain protected

### REQUIRED STORAGE DESIGN

Choose the cleanest minimal implementation.

Preferred direction:
- separate forced preference storage
OR
- clearly distinguished scope/type layer

But do NOT create a confusing mixed model.

You must keep:
- current user_preferences behavior intact
- current /api/me/preferences behavior intact unless extension is necessary
- clean separation between user-owned preferences and admin-forced preferences

### REQUIRED RUNTIME BEHAVIOR

When a forced override exists:
- live consumers must resolve using forced layer first
- user editor should not silently appear to win over forced config
- if needed, show a clear indicator that an admin override is active

Do NOT allow a misleading UX where a user saves a preference but the screen resolves something else without explanation.

### REQUIRED UX

If forced override is active:
- user-facing settings UI must handle this honestly
- either disable conflicting user edits
- or allow editing but clearly state that forced override currently takes precedence

Choose one and implement it cleanly.

Preferred: visible notice + disable conflicting save/apply where appropriate.

---

## REQUIRED VALIDATION

Validate all of the following:

### A. Preset apply
- room preset applies to draft immediately
- sidebar preset applies to draft immediately
- no auto-save
- save persists as expected
- reset still restores default, not “last preset”

### B. Forced override precedence
- forced global beats user global
- forced store beats forced global
- user store beats user global only when no forced override exists
- default used only when no higher layer exists

### C. Security
- unauthorized role cannot modify forced overrides
- forced sidebar config cannot surface forbidden menu ids
- locked items remain protected

### D. Shared propagation
- forced override changes propagate immediately to live consumers
- preset-based saved changes propagate immediately to live consumers

### E. Build/type validation
- tsc --noEmit
- npm run build

---

## OUTPUT FORMAT

Return ONLY this format:

### 1. FILES CHANGED
- exact list

### 2. DESIGN DECISIONS
- preset structure
- forced override storage design
- runtime precedence design
- user UX when forced override is active

### 3. EXACT FIX SUMMARY
- what was added for presets
- what was added for forced overrides
- what remained unchanged intentionally

### 4. VALIDATION RESULTS
- preset apply
- forced precedence
- security
- shared propagation

PASS / FAIL with exact evidence

### 5. COMMAND RESULTS
- tsc --noEmit
- npm run build

### 6. REMAINING RISKS
- only real remaining risks

---

## CONSTRAINTS

- NO BLE work
- NO unrelated refactor
- NO breaking current user preference flow
- NO fake UI-only override
- forced override must be real runtime precedence
- preserve current normalization, locked protections, role filtering, and shared propagation model