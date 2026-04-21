#!/usr/bin/env python3
"""NOX Cross-Store Transfer E2E Test - Step 3

Tests the full transfer flow:
1. Marvel owner creates transfer request for hostess -> Live store
2. Marvel owner approves (from-store side)
3. Live owner approves (to-store side) -> new membership created at Live
4. Run a full session at Live store with the transferred hostess
5. Verify settlement is against Live store_uuid
"""

import json
import os
import sys
import requests

BASE = "http://localhost:3001"
LOGIN_URL = f"{BASE}/api/auth/login"

MARVEL_EMAIL = "tset@gmail.com"
MARVEL_PASSWORD = "xptmxmdlqslek"
LIVE_EMAIL = "live-owner@nox-test.com"
LIVE_PASSWORD = "Test1234!"

MARVEL_STORE_UUID = "ad1b95f0-5023-4c93-9282-efbb3d94ce76"
LIVE_STORE_UUID = "d7f62182-48cb-4731-b694-b1a02d60b1fa"

HOSTESS_MEMBERSHIP_ID = "c0fe65ff-80bd-45af-9cd8-ada2729c41ec"  # marvel-h1 at Marvel
LIVE_ROOM2_UUID = "c44ffa2e-5436-4ced-8d50-13aebfdfdb30"

# SECURITY (SECURITY_FIX_PLAN.md TASK 0-1): secrets must come from env.
SB_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
SB_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
if not SB_URL or not SB_KEY:
    print("[test-step3] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.", file=sys.stderr)
    sys.exit(2)

passed = 0
failed = 0
errors = []


def log(msg):
    print(msg, flush=True)


def ok(test_name, detail=""):
    global passed
    passed += 1
    log(f"  [PASS] {test_name} {detail}")


def fail(test_name, detail=""):
    global failed
    failed += 1
    errors.append(f"{test_name}: {detail}")
    log(f"  [FAIL] {test_name} {detail}")


def api(method, path, token, body=None, params=None):
    url = f"{BASE}{path}"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    if method == "GET":
        r = requests.get(url, headers=headers, params=params, timeout=30)
    else:
        r = requests.post(url, headers=headers, json=body, timeout=30)
    return r


def sb_get(table, params):
    """Direct Supabase REST query"""
    r = requests.get(
        f"{SB_URL}/rest/v1/{table}",
        headers={"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}"},
        params=params,
        timeout=10,
    )
    return r


def sb_patch(table, match_params, body):
    """Direct Supabase REST PATCH"""
    url = f"{SB_URL}/rest/v1/{table}"
    headers = {
        "apikey": SB_KEY,
        "Authorization": f"Bearer {SB_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    r = requests.patch(url, headers=headers, params=match_params, json=body, timeout=10)
    return r


def sb_delete(table, match_params):
    """Direct Supabase REST DELETE"""
    url = f"{SB_URL}/rest/v1/{table}"
    headers = {
        "apikey": SB_KEY,
        "Authorization": f"Bearer {SB_KEY}",
        "Prefer": "return=representation",
    }
    r = requests.delete(url, headers=headers, params=match_params, timeout=10)
    return r


def login(email, password, label=""):
    log(f"  Logging in as {label or email}...")
    r = requests.post(LOGIN_URL, json={"email": email, "password": password}, timeout=15)
    if r.status_code != 200:
        log(f"  Login failed: {r.status_code} {r.text}")
        return None
    data = r.json()
    log(f"  Login OK, token={data['access_token'][:20]}...")
    return data["access_token"]


# =========================================================
# 0. Cleanup: cancel any pending transfers for this hostess
# =========================================================
log("\n=== Step 0: Cleanup ===")

# Cancel any pending transfers involving our hostess
sr = sb_get("transfer_requests", {
    "hostess_membership_id": f"eq.{HOSTESS_MEMBERSHIP_ID}",
    "status": "eq.pending",
    "select": "id",
})
if sr.status_code == 200 and sr.json():
    for tr in sr.json():
        log(f"  Cleaning up pending transfer {tr['id']}...")
        sb_patch("transfer_requests", {"id": f"eq.{tr['id']}"}, {"status": "cancelled"})

# Also clean up any approved transfers (reset hostess membership state)
sr = sb_get("transfer_requests", {
    "hostess_membership_id": f"eq.{HOSTESS_MEMBERSHIP_ID}",
    "status": "eq.approved",
    "select": "id",
})
if sr.status_code == 200 and sr.json():
    for tr in sr.json():
        log(f"  Cleaning up approved transfer {tr['id']}...")
        sb_patch("transfer_requests", {"id": f"eq.{tr['id']}"}, {"status": "cancelled"})

# Get the hostess profile_id
sr = sb_get("store_memberships", {
    "id": f"eq.{HOSTESS_MEMBERSHIP_ID}",
    "select": "profile_id",
})
hostess_profile_id = None
if sr.status_code == 200 and sr.json():
    hostess_profile_id = sr.json()[0]["profile_id"]
    log(f"  Hostess profile_id: {hostess_profile_id}")

    # Ensure the original Marvel membership is primary and approved
    sb_patch("store_memberships",
             {"id": f"eq.{HOSTESS_MEMBERSHIP_ID}"},
             {"is_primary": True, "status": "approved"})
    log(f"  Reset Marvel membership to is_primary=true, status=approved")

    # Remove any existing membership at Live store for this hostess (clean slate)
    existing = sb_get("store_memberships", {
        "profile_id": f"eq.{hostess_profile_id}",
        "store_uuid": f"eq.{LIVE_STORE_UUID}",
        "select": "id",
    })
    if existing.status_code == 200 and existing.json():
        for mem in existing.json():
            log(f"  Removing existing Live membership {mem['id']}...")
            sb_delete("store_memberships", {"id": f"eq.{mem['id']}"})

# Clean up active sessions in Live room 2
sr = sb_get("room_sessions", {
    "room_uuid": f"eq.{LIVE_ROOM2_UUID}",
    "status": "eq.active",
    "select": "id",
})
if sr.status_code == 200 and sr.json():
    live_token_tmp = login(LIVE_EMAIL, LIVE_PASSWORD, "Live owner (cleanup)")
    if live_token_tmp:
        for sess in sr.json():
            log(f"  Checking out active session {sess['id']} in Live room 2...")
            api("POST", "/api/sessions/checkout", live_token_tmp, {"session_id": sess["id"]})

log("  Cleanup complete.")


# =========================================================
# 1. Login as Marvel owner
# =========================================================
log("\n=== Step 1: Login as Marvel owner ===")
marvel_token = login(MARVEL_EMAIL, MARVEL_PASSWORD, "Marvel owner")
if not marvel_token:
    fail("Marvel login", "Could not login")
    log(f"\n{'='*60}")
    log(f"RESULTS: {passed} passed, {failed} failed")
    sys.exit(1)
ok("Marvel login")

# =========================================================
# 2. Create transfer request
# =========================================================
log("\n=== Step 2: Create transfer request ===")
r = api("POST", "/api/transfer/request", marvel_token, {
    "hostess_membership_id": HOSTESS_MEMBERSHIP_ID,
    "to_store_uuid": LIVE_STORE_UUID,
    "reason": "크로스 스토어 테스트",
})
transfer_id = None
if r.status_code == 201:
    tdata = r.json()
    transfer_id = tdata["id"]
    ok("Transfer request created", f"id={transfer_id}")
else:
    fail("Transfer request", f"status={r.status_code} body={r.text[:300]}")

if not transfer_id:
    log("Cannot continue without transfer_id")
    log(f"\n{'='*60}")
    log(f"RESULTS: {passed} passed, {failed} failed")
    sys.exit(1)

# =========================================================
# 3. Marvel owner approves (from-store)
# =========================================================
log("\n=== Step 3: Marvel owner approves (from-store) ===")
r = api("POST", "/api/transfer/approve", marvel_token, {
    "transfer_id": transfer_id,
})
if r.status_code == 200:
    adata = r.json()
    ok("Marvel approval",
       f"approved_side={adata.get('approved_side')} fully_approved={adata.get('fully_approved')}")
    if adata.get("fully_approved"):
        fail("Marvel approval logic", "Should NOT be fully approved yet (only from-store approved)")
else:
    fail("Marvel approval", f"status={r.status_code} body={r.text[:300]}")

# =========================================================
# 4. Login as Live owner
# =========================================================
log("\n=== Step 4: Login as Live owner ===")
live_token = login(LIVE_EMAIL, LIVE_PASSWORD, "Live owner")
if not live_token:
    fail("Live login", "Could not login")
    log(f"\n{'='*60}")
    log(f"RESULTS: {passed} passed, {failed} failed")
    sys.exit(1)
ok("Live login")

# =========================================================
# 5. Live owner approves (to-store) -> should be fully approved
# =========================================================
log("\n=== Step 5: Live owner approves (to-store) ===")
r = api("POST", "/api/transfer/approve", live_token, {
    "transfer_id": transfer_id,
})
if r.status_code == 200:
    adata = r.json()
    ok("Live approval",
       f"approved_side={adata.get('approved_side')} fully_approved={adata.get('fully_approved')}")
    if adata.get("fully_approved"):
        ok("Both sides approved", "Transfer is fully approved")
    else:
        fail("Full approval", "Expected fully_approved=true after both sides approve")
else:
    fail("Live approval", f"status={r.status_code} body={r.text[:300]}")

# =========================================================
# 6. Verify transfer status via list API
# =========================================================
log("\n=== Step 6: Verify transfer status ===")
r = api("GET", "/api/transfer/list", marvel_token, params={"status": "approved"})
if r.status_code == 200:
    ldata = r.json()
    transfers = ldata.get("transfers", [])
    found = any(t["id"] == transfer_id for t in transfers)
    if found:
        ok("Transfer list", f"Transfer {transfer_id[:12]}... found with status=approved")
    else:
        fail("Transfer list", f"Transfer {transfer_id[:12]}... not found in approved list. Got {len(transfers)} transfers.")
else:
    fail("Transfer list", f"status={r.status_code} body={r.text[:300]}")

# =========================================================
# 7. Find the new membership at Live store
# =========================================================
log("\n=== Step 7: Find new membership at Live store ===")
new_live_membership_id = None
if hostess_profile_id:
    sr = sb_get("store_memberships", {
        "profile_id": f"eq.{hostess_profile_id}",
        "store_uuid": f"eq.{LIVE_STORE_UUID}",
        "status": "eq.approved",
        "select": "id,role,is_primary,status",
    })
    if sr.status_code == 200 and sr.json():
        mem = sr.json()[0]
        new_live_membership_id = mem["id"]
        ok("New Live membership",
           f"id={new_live_membership_id} role={mem['role']} is_primary={mem['is_primary']} status={mem['status']}")
    else:
        fail("New Live membership", f"Not found for profile_id={hostess_profile_id} at Live store. Response: {sr.text[:200]}")
else:
    fail("New Live membership", "No hostess_profile_id available")

if not new_live_membership_id:
    log("Cannot continue without new Live membership")
    log(f"\n{'='*60}")
    log(f"RESULTS: {passed} passed, {failed} failed")
    if errors:
        log("\nFAILURES:")
        for e in errors:
            log(f"  - {e}")
    sys.exit(1)

# =========================================================
# 8. Session at Live store with transferred hostess
# =========================================================
log("\n=== Step 8: Session at Live store with transferred hostess ===")

# Clean up any active sessions in room 2 first
sr = sb_get("room_sessions", {
    "room_uuid": f"eq.{LIVE_ROOM2_UUID}",
    "status": "eq.active",
    "select": "id",
})
if sr.status_code == 200 and sr.json():
    for sess in sr.json():
        log(f"  Checking out stale session {sess['id']}...")
        api("POST", "/api/sessions/checkout", live_token, {"session_id": sess["id"]})

# 8a. Checkin room 2 at Live store
log("\n--- 8a. Checkin Live room 2 ---")
r = api("POST", "/api/sessions/checkin", live_token, {"room_uuid": LIVE_ROOM2_UUID})
session_id = None
if r.status_code == 201:
    sdata = r.json()
    session_id = sdata["session_id"]
    session_store_uuid = sdata["store_uuid"]
    ok("Live checkin", f"session_id={session_id[:12]}... store_uuid={session_store_uuid}")
    if session_store_uuid == LIVE_STORE_UUID:
        ok("Session store_uuid", "Session is at Live store")
    else:
        fail("Session store_uuid", f"Expected Live={LIVE_STORE_UUID}, got {session_store_uuid}")
else:
    fail("Live checkin", f"status={r.status_code} body={r.text[:300]}")

if not session_id:
    log("Cannot continue without session_id")
    log(f"\n{'='*60}")
    log(f"RESULTS: {passed} passed, {failed} failed")
    if errors:
        log("\nFAILURES:")
        for e in errors:
            log(f"  - {e}")
    sys.exit(1)

# 8b. Add transferred hostess as participant
log("\n--- 8b. Add transferred hostess as participant ---")
r = api("POST", "/api/sessions/participants", live_token, {
    "session_id": session_id,
    "membership_id": new_live_membership_id,
    "role": "hostess",
    "category": "퍼블릭",
    "time_minutes": 90,
})
participant_id = None
if r.status_code == 201:
    pdata = r.json()
    participant_id = pdata["participant_id"]
    ok("Add participant",
       f"participant_id={participant_id[:12]}... price={pdata['price_amount']}")
else:
    fail("Add participant", f"status={r.status_code} body={r.text[:300]}")

# 8c. Add an order
log("\n--- 8c. Add order ---")
r = api("POST", "/api/sessions/orders", live_token, {
    "session_id": session_id,
    "item_name": "양주",
    "order_type": "주류",
    "qty": 1,
    "unit_price": 100000,
})
if r.status_code == 201:
    odata = r.json()
    ok("Add order", f"order_id={odata['order_id'][:12]}... amount={odata['amount']}")
else:
    fail("Add order", f"status={r.status_code} body={r.text[:300]}")

# 8d. Checkout
log("\n--- 8d. Checkout ---")
r = api("POST", "/api/sessions/checkout", live_token, {"session_id": session_id})
if r.status_code == 200:
    cdata = r.json()
    ok("Checkout", f"status={cdata['status']} participants_closed={cdata['participants_closed_count']}")
else:
    fail("Checkout", f"status={r.status_code} body={r.text[:300]}")

# 8e. Settlement
log("\n--- 8e. Settlement ---")
r = api("POST", "/api/sessions/settlement", live_token, {"session_id": session_id})
settlement_data = None
if r.status_code == 201:
    settlement_data = r.json()
    ok("Settlement",
       f"gross={settlement_data['gross_total']} tc={settlement_data['tc_amount']} "
       f"mgr={settlement_data['manager_amount']} hostess={settlement_data['hostess_amount']} "
       f"margin={settlement_data['margin_amount']}")
else:
    fail("Settlement", f"status={r.status_code} body={r.text[:300]}")

# =========================================================
# 9. Verify settlement is against Live store_uuid
# =========================================================
log("\n=== Step 9: Verify settlement store_uuid ===")
if settlement_data:
    receipt_id = settlement_data.get("receipt_id")
    if receipt_id:
        sr = sb_get("receipts", {
            "id": f"eq.{receipt_id}",
            "select": "id,session_id,store_uuid",
        })
        if sr.status_code == 200 and sr.json():
            receipt = sr.json()[0]
            receipt_store = receipt["store_uuid"]
            if receipt_store == LIVE_STORE_UUID:
                ok("Receipt store_uuid", f"Settlement is against Live store ({LIVE_STORE_UUID}), NOT Marvel")
            else:
                fail("Receipt store_uuid",
                     f"Expected Live={LIVE_STORE_UUID}, got {receipt_store}")
        else:
            fail("Receipt lookup", f"Could not find receipt {receipt_id}")
    else:
        fail("Receipt ID", "No receipt_id in settlement response")

    # Also verify the session store_uuid
    sr = sb_get("room_sessions", {
        "id": f"eq.{session_id}",
        "select": "id,store_uuid",
    })
    if sr.status_code == 200 and sr.json():
        sess = sr.json()[0]
        if sess["store_uuid"] == LIVE_STORE_UUID:
            ok("Session store_uuid in DB", "Session belongs to Live store")
        else:
            fail("Session store_uuid in DB",
                 f"Expected Live={LIVE_STORE_UUID}, got {sess['store_uuid']}")
else:
    fail("Settlement verification", "No settlement data to verify")


# =========================================================
# Summary
# =========================================================
log(f"\n{'='*60}")
log(f"RESULTS: {passed} passed, {failed} failed")
if errors:
    log("\nFAILURES:")
    for e in errors:
        log(f"  - {e}")
else:
    log("\nAll cross-store transfer tests passed!")
log(f"{'='*60}")

sys.exit(0 if failed == 0 else 1)
