STEP-NEXT — SETTLEMENT SIMULATION / VALIDATION IMPLEMENTATION

[STEP ID]
STEP-NEXT-SETTLEMENT-SIM

[TASK TYPE]
controlled implementation

[OBJECTIVE]
Implement settlement simulation and validation scripts to verify all locked settlement rules and edge cases.

This step is NOT UI.
This step is NOT production feature implementation.

This step builds:

simulation dataset
validation scripts
consistency checks
edge case execution

Goal:
Ensure settlement logic does not break under real scenarios.

[PREREQUISITE]

Use ONLY:

locked settlement deep validation rules
existing NOX schema
existing simulation patterns (if available)

NO new business logic allowed.

[SCOPE]

Implement:

settlement simulation script
edge case dataset generation
validation checker
snapshot consistency checker
cross-store settlement validator

[STRICT RULES]

1. No new formulas
DO NOT implement new payout formulas
DO NOT guess missing values

Only simulate and validate existing rules.

FAIL IF:

any new calculation logic appears
2. Simulation must cover edge cases

Must include ALL:

public full / half
shirt full / half
hyper full / half
cha3 boundaries
shirt greeting exception
mid-out
extend
multi-hostess
multi-manager
liquor rules
cross-store settlement
manager pre-settlement
post-checkout correction scenarios

FAIL IF:

any edge group missing
3. Lifecycle simulation required

Simulate full lifecycle:

active session
checkout preview
checkout pending
finalized settlement
business-day close

FAIL IF:

lifecycle stages are skipped
4. Snapshot consistency validation

Must verify:

session data vs settlement
settlement vs receipt snapshot
settlement vs closing snapshot

FAIL IF:

mismatch not detected
5. Cross-store settlement validation

Must simulate:

store-level payable
manager pre-settlement
remaining payable calculation
duplicate payout prevention

FAIL IF:

remaining amount incorrect
duplicate payout not detected
6. Audit simulation

Simulate:

time correction
status change
payout adjustment

Ensure:

audit event would be created

FAIL IF:

mutation without audit trace

[IMPLEMENTATION TARGET]

Recommended script:

scripts/sim-settlement-validation.ts

Optional:

scripts/data/seed-settlement-cases.ts

[SIMULATION STRUCTURE]

Must generate:

Case groups:
Time-based cases
Liquor-based cases
Multi-participant cases
Cross-store cases
Adjustment cases
Snapshot mismatch cases

[VALIDATION OUTPUT]

Script must print or return:

total cases
passed cases
failed cases

For each failure:

case id
failure reason
expected vs actual

[MINIMUM CASE COUNT]

At least:

20+ cases required
must cover ALL edge groups

FAIL IF:

insufficient coverage

[VALIDATION CHECKS]

Each case must verify:

correct settlement amount
correct manager profit
correct hostess earnings
correct store revenue
correct store profit
correct lifecycle lock behavior
correct cross-store payable tracking

[FORBIDDEN]

modifying production API
modifying UI
adding new DB schema
inventing missing data
ignoring locked rules

[REQUIRED VERIFICATION]

Must run:

tsc --noEmit
npm run build

Then run simulation:

tsx scripts/sim-settlement-validation.ts

[OUTPUT FORMAT]

Respond with exactly:

FILES CHANGED
SIMULATION STRUCTURE
CASE COVERAGE SUMMARY
VALIDATION RESULTS
FAILED CASE ANALYSIS
RISKS / FOLLOW-UPS

[STOP CONDITIONS]

STOP after simulation and validation are implemented and results summarized.

This step is SETTLEMENT SIMULATION VALIDATION ONLY.