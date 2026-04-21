[ROUND]
025

[TASK TYPE]
single-file controlled change

[OBJECTIVE]
Implement GET /api/manager/settlement/summary.
Manager only.
Assigned hostess scope only.
Summary only.
No payout math.
No calculation.
No settlement detail leakage.

[TARGET FILE]
C:\work\nox\app\api\manager\settlement\summary\route.ts

[ALLOWED_FILES]
- C:\work\nox\app\api\manager\settlement\summary\route.ts

[FORBIDDEN_FILES]
- C:\work\nox\orchestration\config\state.json
- C:\work\nox\orchestration\config\orchestrator.config.json
- C:\work\nox\package.json
- C:\work\nox\package-lock.json
- C:\work\nox\tsconfig.json
- C:\work\nox\next.config.js

[CONSTRAINTS]
- Must use resolveAuthContext(request)
- role !== "manager" -> 403 ROLE_FORBIDDEN
- Role gate must run before any DB access
- store_uuid must be authContext.store_uuid only
- manager can see only assigned hostesses
- source assignment from manager_hostess_assignments
- use store_uuid filter in all queries
- latest participation per hostess by joined_at desc
- response shape:
  {
    store_uuid: string,
    role: "manager",
    summary: [
      {
        hostess_id: string,
        has_settlement: boolean,
        status: string | null
      }
    ]
  }

[FAIL IF]
- role gate missing
- store_uuid filter missing
- unassigned hostess included
- payout amount exposed
- calculation added
- settlement detail exposed
- multiple files modified
- forbidden files modified

[OUTPUT FORMAT]
FILES CHANGED:
- path

ROOT CAUSE:
- what was missing

EXACT DIFF:
- what was added

VALIDATION:
- role gate check
- assignment filter check
- store scope check
- response shape check
