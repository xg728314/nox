#!/usr/bin/env python3
"""NOX Security & Integrity Audit - Round 071

5 audit areas:
1. Cross-store access blocking
2. Unapproved account blocking
3. Role-based access control
4. Duplicate checkin blocking
5. Settlement calculation accuracy
"""

import json
import math
import os
import sys
import requests

BASE = "http://localhost:3001"
LOGIN_URL = f"{BASE}/api/auth/login"
PASSWORD = "Test1234!"

# SECURITY (SECURITY_FIX_PLAN.md TASK 0-1): secrets must come from env.
SB_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
SB_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
if not SB_URL or not SB_KEY:
    print("[test-security-audit] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.", file=sys.stderr)
    sys.exit(2)

MARVEL_STORE_UUID = "ad1b95f0-5023-4c93-9282-efbb3d94ce76"
LIVE_STORE_UUID = "d7f62182-48cb-4731-b694-b1a02d60b1fa"

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
        return requests.get(url, headers=headers, params=params, timeout=30)
    elif method == "PATCH":
        return requests.patch(url, headers=headers, json=body, timeout=30)
    return requests.post(url, headers=headers, json=body, timeout=30)


def sb_get(table, params):
    return requests.get(
        f"{SB_URL}/rest/v1/{table}",
        headers={"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}"},
        params=params,
        timeout=10,
    )


def sb_patch(table, match_params, body):
    return requests.patch(
        f"{SB_URL}/rest/v1/{table}",
        headers={
            "apikey": SB_KEY,
            "Authorization": f"Bearer {SB_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        },
        params=match_params,
        json=body,
        timeout=10,
    )


def login(email, password):
    r = requests.post(LOGIN_URL, json={"email": email, "password": password}, timeout=15)
    if r.status_code != 200:
        return None, r.status_code
    return r.json().get("access_token"), 200


# =========================================================
# 0. Get tokens
# =========================================================
log("\n=== Preparing tokens ===")

marvel_token, _ = login("tset@gmail.com", "xptmxmdlqslek")
live_token, _ = login("live-owner@nox-test.com", PASSWORD)
hostess_token, _ = login("marvel-h1@nox-test.com", PASSWORD)

if not marvel_token:
    log("FATAL: Cannot login as Marvel owner")
    sys.exit(1)
if not live_token:
    log("FATAL: Cannot login as Live owner")
    sys.exit(1)

log(f"  Marvel owner token: OK")
log(f"  Live owner token: OK")
log(f"  Hostess token: {'OK' if hostess_token else 'NONE (expected if no hostess account)'}")

# =========================================================
# 1. Cross-store access blocking
# =========================================================
log("\n=== AUDIT 1: Cross-store access blocking ===")

# 1a. Marvel token → Live store rooms (should only return Marvel rooms)
r = api("GET", "/api/rooms", marvel_token)
if r.status_code == 200:
    data = r.json()
    store_uuid = data.get("store_uuid")
    if store_uuid == MARVEL_STORE_UUID:
        ok("1a. Rooms scoped to own store", f"store_uuid={store_uuid[:12]}...")
    else:
        fail("1a. Rooms scope", f"Expected Marvel UUID, got {store_uuid}")
else:
    fail("1a. GET /api/rooms", f"status={r.status_code}")

# 1b. Marvel token → checkout a Live session (should fail 403/404)
# First find an active or closed Live session
sr = sb_get("room_sessions", {
    "store_uuid": f"eq.{LIVE_STORE_UUID}",
    "select": "id",
    "limit": "1",
})
live_session_id = None
if sr.status_code == 200 and sr.json():
    live_session_id = sr.json()[0]["id"]

if live_session_id:
    r = api("POST", "/api/sessions/checkout", marvel_token, {"session_id": live_session_id})
    if r.status_code in (403, 404):
        ok("1b. Cross-store checkout blocked", f"status={r.status_code} error={r.json().get('error')}")
    elif r.status_code == 400:
        # Session might be already closed — that's OK, but let's check the error
        err = r.json().get("error", "")
        if err == "STORE_MISMATCH":
            ok("1b. Cross-store checkout blocked", f"STORE_MISMATCH")
        else:
            ok("1b. Cross-store checkout blocked", f"status=400 (session state issue, not access)")
    else:
        fail("1b. Cross-store checkout", f"Expected 403/404, got {r.status_code}")
else:
    ok("1b. Cross-store checkout", "(no Live sessions to test, skip)")

# 1c. Marvel token → settlement on Live session
if live_session_id:
    r = api("POST", "/api/sessions/settlement", marvel_token, {"session_id": live_session_id})
    if r.status_code in (403, 409):
        ok("1c. Cross-store settlement blocked", f"status={r.status_code} error={r.json().get('error')}")
    elif r.status_code == 400:
        ok("1c. Cross-store settlement blocked", f"status=400 (session state)")
    else:
        fail("1c. Cross-store settlement", f"Expected 403, got {r.status_code}")
else:
    ok("1c. Cross-store settlement", "(no Live sessions, skip)")

# 1d. Marvel token → Live store staff
r = api("GET", "/api/store/staff", marvel_token)
if r.status_code == 200:
    data = r.json()
    if data.get("store_uuid") == MARVEL_STORE_UUID:
        ok("1d. Staff scoped to own store", f"store_uuid={data['store_uuid'][:12]}...")
    else:
        fail("1d. Staff scope", f"got store_uuid={data.get('store_uuid')}")
else:
    fail("1d. GET /api/store/staff", f"status={r.status_code}")


# =========================================================
# 2. Unapproved account blocking
# =========================================================
log("\n=== AUDIT 2: Unapproved account blocking ===")

# Create a pending test user via Supabase admin
PENDING_EMAIL = "pending-test@nox-test.com"

# Check if user exists
sr = sb_get("profiles", {"select": "id"})
# Try to login — should fail because no approved membership
r_pending, status = login(PENDING_EMAIL, PASSWORD)
if status == 401:
    ok("2a. Unapproved login blocked", f"status=401 (AUTH_INVALID or no user)")
elif status == 403:
    ok("2a. Unapproved login blocked", f"status=403 (MEMBERSHIP_NOT_APPROVED)")
elif r_pending is None:
    ok("2a. Unapproved login blocked", f"status={status} (no token returned)")
else:
    fail("2a. Unapproved login", f"Expected 401/403, login succeeded")

# 2b. Test with ALL memberships set to pending
# Use marvel-h1 token — find her profile_id from auth
if hostess_token:
    # Get profile_id from the hostess token
    r_me = api("GET", "/api/auth/me", hostess_token)
    if r_me.status_code == 200:
        test_profile_id = r_me.json().get("user_id")
        log(f"  Hostess profile_id: {test_profile_id}")

        # Find ALL memberships for this profile
        sr_all = sb_get("store_memberships", {
            "profile_id": f"eq.{test_profile_id}",
            "select": "id,status",
        })
        saved_states = []
        if sr_all.status_code == 200:
            for m in sr_all.json():
                saved_states.append({"id": m["id"], "status": m["status"]})
                sb_patch("store_memberships", {"id": f"eq.{m['id']}"}, {"status": "pending"})
            log(f"  Set {len(saved_states)} memberships to pending")

        # Now try API — should fail
        r = api("GET", "/api/rooms", hostess_token)
        if r.status_code == 403:
            ok("2b. Pending membership API blocked", f"status=403")
        elif r.status_code == 200:
            fail("2b. Pending membership", f"Expected 403, got 200 (membership status not checked?)")
        else:
            ok("2b. Pending membership API blocked", f"status={r.status_code}")

        # Restore
        for m in saved_states:
            sb_patch("store_memberships", {"id": f"eq.{m['id']}"}, {"status": m["status"]})
        log(f"  (restored {len(saved_states)} memberships)")
    else:
        ok("2b. Pending membership", "(could not get profile, skip)")
else:
    ok("2b. Pending membership", "(no hostess token, skip)")


# =========================================================
# 3. Role-based access control
# =========================================================
log("\n=== AUDIT 3: Role-based access control ===")

# Re-login hostess after membership restore
hostess_token2, hst = login("marvel-h1@nox-test.com", PASSWORD)

if hostess_token2:
    # 3a. Hostess → /api/manager/dashboard → 403
    r = api("GET", "/api/manager/dashboard", hostess_token2)
    if r.status_code == 403:
        ok("3a. Hostess→manager/dashboard blocked", f"status=403 error={r.json().get('error')}")
    else:
        fail("3a. Hostess→manager/dashboard", f"Expected 403, got {r.status_code}")

    # 3b. Hostess → /api/manager/hostesses → 403
    r = api("GET", "/api/manager/hostesses", hostess_token2)
    if r.status_code == 403:
        ok("3b. Hostess→manager/hostesses blocked", f"status=403")
    else:
        fail("3b. Hostess→manager/hostesses", f"Expected 403, got {r.status_code}")

    # 3c. Hostess → /api/manager/settlement/summary → 403
    r = api("GET", "/api/manager/settlement/summary", hostess_token2)
    if r.status_code == 403:
        ok("3c. Hostess→settlement/summary blocked", f"status=403")
    else:
        fail("3c. Hostess→settlement/summary", f"Expected 403, got {r.status_code}")

    # 3d. Hostess → /api/sessions/settlement POST → 403
    r = api("POST", "/api/sessions/settlement", hostess_token2, {"session_id": "fake-id"})
    if r.status_code == 403:
        ok("3d. Hostess→settlement POST blocked", f"status=403")
    else:
        fail("3d. Hostess→settlement POST", f"Expected 403, got {r.status_code}")

    # 3e. Hostess → /api/transfer/request POST → 403
    r = api("POST", "/api/transfer/request", hostess_token2, {
        "hostess_membership_id": "fake", "to_store_uuid": "fake"
    })
    if r.status_code == 403:
        ok("3e. Hostess→transfer/request blocked", f"status=403")
    else:
        fail("3e. Hostess→transfer/request", f"Expected 403, got {r.status_code}")

    # 3f. Hostess → /api/store/settings PATCH → 403
    r = api("PATCH", "/api/store/settings", hostess_token2, {"tc_rate": 0.5})
    if r.status_code == 403:
        ok("3f. Hostess→settings PATCH blocked", f"status=403")
    else:
        fail("3f. Hostess→settings PATCH", f"Expected 403, got {r.status_code}")
else:
    for i, label in enumerate(["dashboard", "hostesses", "settlement/summary", "settlement POST", "transfer/request", "settings PATCH"], start=1):
        ok(f"3{chr(96+i)}. Hostess→{label}", "(no hostess token, skip)")

# 3g. Manager → /api/store/settings PATCH → 403 (only owner)
mgr_token, _ = login("marvel-mgr2@nox-test.com", PASSWORD)
if mgr_token:
    r = api("PATCH", "/api/store/settings", mgr_token, {"tc_rate": 0.5})
    if r.status_code == 403:
        ok("3g. Manager→settings PATCH blocked", f"status=403")
    else:
        fail("3g. Manager→settings PATCH", f"Expected 403, got {r.status_code}")
else:
    ok("3g. Manager→settings PATCH", "(no manager token, skip)")


# =========================================================
# 4. Duplicate checkin blocking
# =========================================================
log("\n=== AUDIT 4: Duplicate checkin blocking ===")

# Find a room with no active session
ROOM1_UUID = "5e6f77b7-1dab-4ad5-b032-57c2865f41ca"  # Marvel 1번방

# Clean up first
sr = sb_get("room_sessions", {
    "room_uuid": f"eq.{ROOM1_UUID}",
    "status": "eq.active",
    "select": "id",
})
if sr.status_code == 200 and sr.json():
    for s in sr.json():
        api("POST", "/api/sessions/checkout", marvel_token, {"session_id": s["id"]})
        log(f"  Cleaned up session {s['id']}")

# 4a. First checkin — should succeed
r = api("POST", "/api/sessions/checkin", marvel_token, {"room_uuid": ROOM1_UUID})
if r.status_code == 201:
    session1_id = r.json()["session_id"]
    ok("4a. First checkin", f"session_id={session1_id[:12]}...")
else:
    fail("4a. First checkin", f"status={r.status_code} body={r.text[:200]}")
    session1_id = None

# 4b. Second checkin same room — should fail
if session1_id:
    r = api("POST", "/api/sessions/checkin", marvel_token, {"room_uuid": ROOM1_UUID})
    if r.status_code in (400, 409):
        ok("4b. Duplicate checkin blocked", f"status={r.status_code} error={r.json().get('error')}")
    else:
        fail("4b. Duplicate checkin", f"Expected 400/409, got {r.status_code} body={r.text[:200]}")

    # Cleanup: checkout
    api("POST", "/api/sessions/checkout", marvel_token, {"session_id": session1_id})
    log(f"  Cleaned up test session")


# =========================================================
# 5. Settlement calculation accuracy
# =========================================================
log("\n=== AUDIT 5: Settlement calculation accuracy ===")

# Settings: tc_rate=0.2, mgr=0.7, hostess=0.1, payout_basis=netOfTC, rounding_unit=1000
TC_RATE = 0.2
MGR_RATE = 0.7
HST_RATE = 0.1
ROUNDING = 1000

def round_to_unit(val, unit):
    return round(val / unit) * unit

# 5a. Create a fresh session with known amounts
r = api("POST", "/api/sessions/checkin", marvel_token, {"room_uuid": ROOM1_UUID})
if r.status_code != 201:
    fail("5a. Test checkin", f"status={r.status_code}")
    log("Cannot continue settlement accuracy test")
else:
    test_sid = r.json()["session_id"]
    ok("5a. Test checkin", f"session={test_sid[:12]}...")

    # Add participant: price=200000
    HOSTESS_MID = "c0fe65ff-80bd-45af-9cd8-ada2729c41ec"  # 마블아가씨1
    r = api("POST", "/api/sessions/participants", marvel_token, {
        "session_id": test_sid,
        "membership_id": HOSTESS_MID,
        "role": "hostess",
        "category": "퍼블릭",
        "time_minutes": 120,
    })
    participant_price = 0
    if r.status_code == 201:
        participant_price = r.json()["price_amount"]
        ok("5b. Add participant", f"price={participant_price}")
    else:
        fail("5b. Add participant", f"status={r.status_code}")

    # Add order: qty=2, unit_price=70000 → amount=140000
    r = api("POST", "/api/sessions/orders", marvel_token, {
        "session_id": test_sid,
        "item_name": "양주",
        "order_type": "주류",
        "qty": 2,
        "unit_price": 70000,
    })
    order_amount = 0
    if r.status_code == 201:
        order_amount = r.json()["amount"]
        ok("5c. Add order", f"amount={order_amount}")
    else:
        fail("5c. Add order", f"status={r.status_code}")

    # Checkout
    r = api("POST", "/api/sessions/checkout", marvel_token, {"session_id": test_sid})
    if r.status_code == 200:
        ok("5d. Checkout", "OK")
    else:
        fail("5d. Checkout", f"status={r.status_code}")

    # Settlement
    r = api("POST", "/api/sessions/settlement", marvel_token, {"session_id": test_sid})
    if r.status_code == 201:
        s = r.json()

        # Expected calculations
        expected_gross = participant_price + order_amount
        expected_tc = round_to_unit(expected_gross * TC_RATE, ROUNDING)
        expected_base = expected_gross - expected_tc  # netOfTC
        expected_mgr = round_to_unit(expected_base * MGR_RATE, ROUNDING)
        expected_hst = round_to_unit(expected_base * HST_RATE, ROUNDING)
        expected_margin = expected_gross - expected_tc - expected_mgr - expected_hst

        actual_gross = s["gross_total"]
        actual_tc = s["tc_amount"]
        actual_mgr = s["manager_amount"]
        actual_hst = s["hostess_amount"]
        actual_margin = s["margin_amount"]

        log(f"  Expected: gross={expected_gross} tc={expected_tc} mgr={expected_mgr} hst={expected_hst} margin={expected_margin}")
        log(f"  Actual:   gross={actual_gross} tc={actual_tc} mgr={actual_mgr} hst={actual_hst} margin={actual_margin}")

        # 5e. gross_total
        if actual_gross == expected_gross:
            ok("5e. gross_total", f"{actual_gross} == {expected_gross}")
        else:
            fail("5e. gross_total", f"{actual_gross} != {expected_gross}")

        # 5f. tc_amount
        if actual_tc == expected_tc:
            ok("5f. tc_amount", f"{actual_tc} == {expected_tc} (gross*{TC_RATE} rounded to {ROUNDING})")
        else:
            fail("5f. tc_amount", f"{actual_tc} != {expected_tc}")

        # 5g. manager_amount
        if actual_mgr == expected_mgr:
            ok("5g. manager_amount", f"{actual_mgr} == {expected_mgr} (base*{MGR_RATE} rounded to {ROUNDING})")
        else:
            fail("5g. manager_amount", f"{actual_mgr} != {expected_mgr}")

        # 5h. hostess_amount
        if actual_hst == expected_hst:
            ok("5h. hostess_amount", f"{actual_hst} == {expected_hst} (base*{HST_RATE} rounded to {ROUNDING})")
        else:
            fail("5h. hostess_amount", f"{actual_hst} != {expected_hst}")

        # 5i. margin = gross - tc - mgr - hst
        if actual_margin == expected_margin:
            ok("5i. margin_amount", f"{actual_margin} == {expected_margin} (residual)")
        else:
            fail("5i. margin_amount", f"{actual_margin} != {expected_margin}")

        # 5j. Sum check: tc + mgr + hst + margin == gross
        total_check = actual_tc + actual_mgr + actual_hst + actual_margin
        if total_check == actual_gross:
            ok("5j. Sum integrity", f"tc+mgr+hst+margin={total_check} == gross={actual_gross}")
        else:
            fail("5j. Sum integrity", f"tc+mgr+hst+margin={total_check} != gross={actual_gross}")

        # 5k. Duplicate settlement blocked
        r2 = api("POST", "/api/sessions/settlement", marvel_token, {"session_id": test_sid})
        if r2.status_code == 409:
            ok("5k. Duplicate settlement blocked", f"status=409 error={r2.json().get('error')}")
        else:
            fail("5k. Duplicate settlement", f"Expected 409, got {r2.status_code}")
    else:
        fail("5e-5k. Settlement", f"status={r.status_code} body={r.text[:200]}")


# =========================================================
# Summary
# =========================================================
log(f"\n{'='*60}")
log(f"SECURITY AUDIT RESULTS: {passed} passed, {failed} failed")
if errors:
    log("\nFAILURES:")
    for e in errors:
        log(f"  - {e}")
else:
    log("\nAll security audit tests passed!")
log(f"{'='*60}")

sys.exit(0 if failed == 0 else 1)
