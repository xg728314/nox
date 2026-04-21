#!/usr/bin/env python3
"""NOX Live Store E2E Test - Step 2"""

import json
import os
import sys
import requests

BASE = "http://localhost:3001"
LOGIN_URL = f"{BASE}/api/auth/login"
EMAIL = "live-owner@nox-test.com"
PASSWORD = "Test1234!"

STORE_UUID = "d7f62182-48cb-4731-b694-b1a02d60b1fa"
ROOM1_UUID = "158720fd-c5c5-4e7c-95cd-4fd4b4562600"
ROOM1_NAME = "1번방"
HOSTESS1_MID = "2afe4dfc-ccbf-4303-88db-77b3e53cf46b"

# SECURITY (SECURITY_FIX_PLAN.md TASK 0-1): secrets must come from env.
SB_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
SB_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
if not SB_URL or not SB_KEY:
    print("[test-step2] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.", file=sys.stderr)
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


# =========================================================
# 0. Login
# =========================================================
log("\n=== Step 0: Login ===")
try:
    r = requests.post(LOGIN_URL, json={"email": EMAIL, "password": PASSWORD}, timeout=15)
    if r.status_code != 200:
        log(f"Login failed: {r.status_code} {r.text}")
        sys.exit(1)
    token = r.json()["access_token"]
    ok("Login", f"token={token[:20]}...")
except Exception as e:
    log(f"Login error: {e}")
    sys.exit(1)

# =========================================================
# 1. GET /api/rooms - verify 6 rooms
# =========================================================
log("\n=== Step 1: GET /api/rooms ===")
r = api("GET", "/api/rooms", token)
if r.status_code == 200:
    data = r.json()
    rooms = data.get("rooms", [])
    room_names = [rm.get("room_name") for rm in rooms]
    if len(rooms) == 6:
        ok("Rooms count=6", f"names={room_names}")
    else:
        fail("Rooms count", f"expected 6, got {len(rooms)}. names={room_names}")
else:
    fail("GET /api/rooms", f"status={r.status_code} body={r.text[:200]}")

# =========================================================
# 2. Clean up active sessions in room 1
# =========================================================
log("\n=== Step 2: Clean up active sessions in room 1 ===")
sr = sb_get("room_sessions", {
    "room_uuid": f"eq.{ROOM1_UUID}",
    "status": "eq.active",
    "select": "id",
})
if sr.status_code == 200 and sr.json():
    for sess in sr.json():
        sid = sess["id"]
        log(f"  Found active session {sid} in {ROOM1_NAME}, checking out...")
        cr = api("POST", "/api/sessions/checkout", token, {"session_id": sid})
        log(f"    Checkout: {cr.status_code}")
        # Also clean up any receipt for this session so settlement can run fresh
else:
    log(f"  No active session in {ROOM1_NAME}")

# Also clean up any closed-but-unsettled sessions that would block a clean test
sr2 = sb_get("room_sessions", {
    "room_uuid": f"eq.{ROOM1_UUID}",
    "status": "eq.closed",
    "select": "id",
})
if sr2.status_code == 200 and sr2.json():
    for sess in sr2.json():
        # Check if receipt exists
        rr = sb_get("receipts", {"session_id": f"eq.{sess['id']}", "select": "id"})
        if rr.status_code == 200 and not rr.json():
            log(f"  Found closed session without receipt {sess['id']}, settling...")
            sr3 = api("POST", "/api/sessions/settlement", token, {"session_id": sess["id"]})
            log(f"    Settlement: {sr3.status_code}")

# =========================================================
# 3. Full E2E on room 1
# =========================================================
log("\n=== Step 3: Full E2E on room 1 ===")
session_id = None
business_day_id = None

# 3a. Checkin
log("\n--- 3a. Checkin ---")
r = api("POST", "/api/sessions/checkin", token, {"room_uuid": ROOM1_UUID})
if r.status_code == 201:
    data = r.json()
    session_id = data["session_id"]
    ok("Checkin", f"session_id={session_id[:12]}...")
else:
    fail("Checkin", f"status={r.status_code} body={r.text[:300]}")

if session_id:
    # 3b. Add participant (hostess)
    log("\n--- 3b. Add participant ---")
    r = api("POST", "/api/sessions/participants", token, {
        "session_id": session_id,
        "membership_id": HOSTESS1_MID,
        "role": "hostess",
        "category": "\ud37c\ube14\ub9ad",
        "time_minutes": 90,
    })
    if r.status_code == 201:
        pdata = r.json()
        ok("Participant", f"participant_id={pdata['participant_id'][:12]}... price={pdata['price_amount']}")
    else:
        fail("Participant", f"status={r.status_code} body={r.text[:300]}")

    # 3c. Add order
    log("\n--- 3c. Add order ---")
    r = api("POST", "/api/sessions/orders", token, {
        "session_id": session_id,
        "item_name": "\uc591\uc8fc",
        "order_type": "\uc8fc\ub958",
        "qty": 2,
        "unit_price": 80000,
    })
    if r.status_code == 201:
        odata = r.json()
        ok("Order", f"order_id={odata['order_id'][:12]}... amount={odata['amount']}")
    else:
        fail("Order", f"status={r.status_code} body={r.text[:300]}")

    # 3d. Checkout
    log("\n--- 3d. Checkout ---")
    r = api("POST", "/api/sessions/checkout", token, {"session_id": session_id})
    if r.status_code == 200:
        cdata = r.json()
        ok("Checkout", f"status={cdata['status']} participants_closed={cdata['participants_closed_count']}")
    else:
        fail("Checkout", f"status={r.status_code} body={r.text[:300]}")

    # 3e. Settlement
    log("\n--- 3e. Settlement ---")
    r = api("POST", "/api/sessions/settlement", token, {"session_id": session_id})
    if r.status_code == 201:
        sdata = r.json()
        business_day_id = sdata.get("business_day_id")
        ok("Settlement",
           f"gross={sdata['gross_total']} tc={sdata['tc_amount']} mgr={sdata['manager_amount']} "
           f"hostess={sdata['hostess_amount']} margin={sdata['margin_amount']}")
    else:
        fail("Settlement", f"status={r.status_code} body={r.text[:300]}")

# =========================================================
# 4. GET /api/store/staff
# =========================================================
log("\n=== Step 4: GET /api/store/staff ===")
r = api("GET", "/api/store/staff", token)
if r.status_code == 200:
    sdata = r.json()
    staff = sdata.get("staff", [])
    if len(staff) > 0:
        names_sample = [f"{s.get('name', 'N/A')}({s.get('role', 'N/A')})" for s in staff[:6]]
        ok("Store staff", f"count={len(staff)} sample={names_sample}")
    else:
        fail("Store staff", "empty staff list")
else:
    fail("Store staff", f"status={r.status_code} body={r.text[:300]}")

# =========================================================
# 5. GET /api/manager/settlement/summary
# =========================================================
log("\n=== Step 5: GET /api/manager/settlement/summary ===")
r = api("GET", "/api/manager/settlement/summary", token)
if r.status_code == 200:
    sdata = r.json()
    ok("Settlement summary", f"keys={list(sdata.keys())} len={len(json.dumps(sdata)[:100])}")
else:
    fail("Settlement summary", f"status={r.status_code} body={r.text[:300]}")

# =========================================================
# 6. GET /api/reports/daily
# =========================================================
log("\n=== Step 6: GET /api/reports/daily ===")
if business_day_id:
    r = api("GET", "/api/reports/daily", token, params={"business_day_id": business_day_id})
    if r.status_code == 200:
        rdata = r.json()
        totals = rdata.get("totals", {})
        ok("Daily report", f"sessions={totals.get('session_count')} gross={totals.get('gross_total')} receipts={len(rdata.get('receipts', []))}")
    else:
        fail("Daily report", f"status={r.status_code} body={r.text[:300]}")
else:
    # Try to get business_day_id from rooms endpoint
    log("  No business_day_id from settlement, trying rooms endpoint...")
    r = api("GET", "/api/rooms", token)
    if r.status_code == 200:
        bd = r.json().get("business_day_id")
        if bd:
            business_day_id = bd
            r2 = api("GET", "/api/reports/daily", token, params={"business_day_id": bd})
            if r2.status_code == 200:
                rdata = r2.json()
                totals = rdata.get("totals", {})
                ok("Daily report", f"sessions={totals.get('session_count')} gross={totals.get('gross_total')}")
            else:
                fail("Daily report", f"status={r2.status_code} body={r2.text[:300]}")
        else:
            fail("Daily report", "No business_day_id available")
    else:
        fail("Daily report", "Could not get business_day_id")


# =========================================================
# Summary
# =========================================================
log(f"\n{'='*60}")
log(f"RESULTS: {passed} passed, {failed} failed")
if errors:
    log("\nFAILURES:")
    for e in errors:
        log(f"  - {e}")
log(f"{'='*60}")

sys.exit(0 if failed == 0 else 1)
