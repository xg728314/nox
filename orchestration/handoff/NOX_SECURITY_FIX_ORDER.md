# NOX SECURITY FIX ORDER

## P0 — production blocking

### R-1
Remove access_token from localStorage completely
- move to HttpOnly cookie / server session model
- remove all client token reads
- remove all manual bearer injection from browser token storage

### R-2
Fix apiFetch so it never sends Bearer null
- fail closed if auth missing
- no malformed Authorization header

### R-3
Fix IP spoof vulnerability
- do not trust raw X-Forwarded-For unless proxy chain is trusted
- normalize client IP extraction
- ensure rate-limit cannot be bypassed by spoofed header

### R-4
Fix PostgREST filter injection
- sanitize/escape user input before .or()
- prevent attacker-controlled filter expression injection

## P1 — important follow-up

### R-5
Escape LIKE wildcards (% and _)

### R-6
Add is_primary=true to login membership query if that is the intended invariant

### R-7
Replace or reinforce in-memory rate limit for non-sticky/serverless environments

### R-8
Use timing-safe comparison for CRON secret

### R-9
Fix signup duplicate-email validation logic

### R-10
Audit store_uuid coverage and tenant isolation continuously

### D-1
Remove old key fragment from handoff docs