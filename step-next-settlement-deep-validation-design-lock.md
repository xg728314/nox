STEP-NEXT — SETTLEMENT DEEP VALIDATION DESIGN LOCK

[STEP ID]
STEP-NEXT-SETTLEMENT-LOCK

[TASK TYPE]
design lock (no implementation)

[OBJECTIVE]
Define and lock the deep validation rules for NOX settlement behavior.

This step is NOT about UI polish.
This step is NOT about implementation.
This step is about locking settlement edge cases, adjustment rules, snapshot consistency, and cross-store payout behavior.

NO guessing allowed.
NO inferred formulas beyond already confirmed business rules.

[LOCKED BUSINESS RULES]

Use ONLY the already confirmed rules below.

1. Liquor (양주)
manager_profit = sale_price - deposit_price
hostess_profit_from_liquor = 0
store_revenue = deposit_price
store_profit = deposit_price - bottle_cost
2. Hostess earnings

Hostess earnings come from room time worked.
NOT from liquor margin.

3. Time pricing

Public:

90 min = 130,000
half = 70,000

Shirt:

60 min = 140,000
half = 70,000

Hyper:

60 min = 120,000
half = 60,000
4. Cha3
9~15 minutes
default = 30,000

Shirt exception:

greeting occurred -> NOT cha3
instead half-time = 70,000

If not specially checked:

default cha3 = 30,000
5. Session time can be adjusted

Session time may be adjusted after discussion between hostess and manager.

6. Cross-store settlement

Default grouping is store-level first.

Example:

amount owed to Bali store = 1,200,000
store-level total is the primary tracking unit

Partial pre-settlement to individual managers must be possible.

Example:

one manager pre-settled 400,000
remaining payable to store becomes 800,000
7. Business day

Business day does NOT close at fixed clock time.
A day remains open until explicit closing action.

[SCOPE]

Define and lock:

settlement validation dimensions
settlement edge-case categories
adjustment policy
snapshot consistency rules
cross-store settlement validation structure
audit requirements for settlement changes
pass/fail criteria for validation

[STRICT RULES]

1. No new formulas

Do NOT invent any pricing formulas beyond locked rules.

FAIL IF:

any new settlement formula is introduced
any payout logic is inferred without prior confirmation
2. Time settlement must distinguish lifecycle stages

Need clear rule separation between:

active session
checkout preview
checkout pending
finalized settlement
closed business day

The design must explicitly state where edits are allowed and where they are forbidden.

FAIL IF:

editability is ambiguous
finalized vs preview values are mixed
3. Adjustment policy must be explicit

Need locked rule for:

when time/session values can still change
what happens after checkout
what happens after settlement finalization
what happens after business-day close

Must define whether post-final changes are:

forbidden
or adjustment-only with audit trail

FAIL IF:

post-final behavior is undefined
closed-day mutation behavior is ambiguous
4. Snapshot consistency is mandatory

Need explicit consistency boundaries between:

session record
participant settlement values
receipt snapshot
closing snapshot
payout summary

Design must define what must match, when it must match, and what causes invalid state.

FAIL IF:

snapshot consistency rules are omitted
settlement can diverge silently from receipt/closing data
5. Cross-store settlement must remain store-first

Default tracking unit is store-level payable.

Need explicit handling for:

manager-level pre-settlement
remaining store payable
hostess-level detail traceability
duplicate payout prevention

FAIL IF:

design shifts primary settlement unit away from store level
manager pre-settlement is not reconciled into remaining store payable
6. Liquor responsibility must be explicit

Need design clarity for:

sale price validation
deposit floor enforcement
bottle cost linkage
responsible manager attribution timing

Must define whether liquor profit responsibility is fixed at:

order creation time
checkout time
settlement time

FAIL IF:

responsible manager timing is undefined
sale below deposit is not blocked in validation rules
7. Auditability is mandatory

All material settlement changes must be auditable.

Need explicit audit requirements for:

time adjustments
status changes
payout adjustments
cross-store pre-settlement
post-checkout corrections

FAIL IF:

settlement mutation paths exist without audit requirements

[REQUIRED VALIDATION DIMENSIONS]

Design must cover at minimum:

A. Time calculation validation
full-time
half-time
cha3
boundary minutes
category-specific pricing
shirt greeting exception
B. Session lifecycle validation
active editing
checkout preview
checkout pending
finalized
business-day closed
C. Correction / adjustment validation
pre-final correction
post-final correction
closed-day correction
adjustment logging
who can authorize change
D. Liquor validation
deposit floor enforcement
manager profit
hostess zero liquor share
store revenue / store profit linkage
responsibility timing
E. Multi-participant complexity
multiple hostesses
multiple managers
mid-out
extend
split timing scenarios
F. Cross-store settlement validation
store-level payable
manager pre-settlement
remainder tracking
hostess detail drill-down
duplicate payout prevention
G. Snapshot / reporting consistency
receipt snapshot alignment
settlement snapshot alignment
closing report alignment
payout summary alignment

[MANDATORY EDGE CASE GROUPS]

The design must explicitly include test/validation groups for:

Public full / half
Shirt full / half
Hyper full / half
Cha3 boundary:
8 min
9 min
15 min
16 min
Shirt greeting exception
Checkout completed but value corrected before final settlement
Finalized settlement later disputed
Closed business day correction request
Liquor sold at deposit floor
Liquor attempted below deposit floor
Multiple hostesses in one room
Mid-out participant
Extend after partial participant exit
Cross-store payable with one manager pre-settled
Cross-store payable with multiple manager pre-settlements
Receipt snapshot vs settlement mismatch
Closing snapshot vs settlement mismatch
Duplicate payout attempt prevention

[DESIGN QUESTIONS TO LOCK]

The output MUST explicitly answer:

At what stage can time values still be edited?
At what stage do values become locked?
After lock, are changes forbidden or adjustment-only?
What is the source of truth for finalized settlement?
What must match between receipt / settlement / closing snapshots?
When is liquor responsibility fixed?
How is store-level cross-store payable reduced after manager pre-settlement?
How are hostess-level details preserved under store-level settlement?
What is the invalid-state definition?
What events must be written to audit logs?

[REQUIRED OUTPUT FORMAT]

Respond with exactly:

VALIDATION DIMENSIONS
LIFECYCLE LOCK RULES
ADJUSTMENT POLICY
LIQUOR VALIDATION RULES
CROSS-STORE SETTLEMENT VALIDATION
SNAPSHOT CONSISTENCY RULES
AUDIT REQUIREMENTS
EDGE CASE MATRIX
INVALID STATE DEFINITIONS
PASS / FAIL CRITERIA

[FORBIDDEN]

code implementation
UI implementation
schema migration
speculative formulas
changing already locked business rules
mixing printer/account-management scope into this step

[STOP CONDITIONS]

STOP after design lock is complete.

DO NOT:

write application code
modify routes
build UI
invent missing business formulas

This step is SETTLEMENT DEEP VALIDATION DESIGN LOCK ONLY.