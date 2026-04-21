You are working in NOX (C:\work\nox).

This round connects monitor operator actions to the apply-actions pipeline.

OBJECTIVE:
Allow operators to explicitly apply recorded actions from the monitor UI.

DO NOT:
- auto-apply actions
- connect BLE to mutation
- modify settlement logic
- remove /counter

IMPLEMENT:

1. Modify ActionPopover:
- add "적용" button
- show action state:
  - recorded (미적용)
  - applied (적용됨)

2. Add state logic:
- detect if last_applied_action_id < latest action
- show pending state

3. On "적용" click:
POST /api/sessions/participants/apply-actions
body: { participant_id }

4. On success:
- show success message
- refresh monitor data
- update UI state

5. On failure:
- show error
- keep state unchanged

6. Disable button if:
- no pending actions
- request in progress

7. Keep everything safe:
- no automatic application
- no mutation outside apply-actions
- no BLE influence

OUTPUT:
1. FILES CHANGED
2. UI FLOW
3. APPLY FLOW
4. STATE HANDLING
5. SAFETY CONFIRMATION
6. VALIDATION