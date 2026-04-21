[ROUND]
026

[TASK TYPE]
single-file controlled change

[OBJECTIVE]
Implement GET /api/store/settlement/overview.
Owner only.
Same-store full hostess scope.
Summary only.
No payout math.
No calculation.
No settlement detail leakage.

[TARGET FILE]
C:\work\nox\app\api\store\settlement\overview\route.ts

[ALLOWED_FILES]
- C:\work\nox\app\api\store\settlement\overview\route.ts

[FORBIDDEN_FILES]
- C:\work\nox\orchestration\config\state.json
- C:\work\nox\orchestration\config\orchestrator.config.json
- C:\work\nox\package.json
- C:\work\nox\package-lock.json
- C:\work\nox\tsconfig.json
- C:\work\nox\next.config.js

[CONSTRAINTS]
- Must use resolveAuthContext(request)
- role !== "owner" -> 403 ROLE_FORBIDDEN
- Role gate must run before any DB access
- store_uuid must be authContext.store_uuid only
- owner can see all hostesses in same store
- no assignment restriction
- source hostess list from store_memberships
- role filter must be hostess only
- use store_uuid filter in all queries
- latest participation per hostess by joined_at desc
- response shape:
  {
    store_uuid: string,
    role: "owner",
    overview: [
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
- non-hostess included
- cross-store data included
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
- hostess scope check
- store scope check
- response shape check
