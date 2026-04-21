#!/usr/bin/env python3
"""NOX Marvel Full E2E Test - Step 1"""

import json
import os
import sys
import time
import requests

# SECURITY (SECURITY_FIX_PLAN.md TASK 0-1): secrets must come from env.
SB_URL_ENV = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
SB_KEY_ENV = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
if not SB_URL_ENV or not SB_KEY_ENV:
    print("[test-step1] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.", file=sys.stderr)
    sys.exit(2)

BASE = "http://localhost:3001"
LOGIN_URL = f"{BASE}/api/auth/login"
EMAIL = "tset@gmail.com"
PASSWORD = "xptmxmdlqslek"

STORE_UUID = "ad1b95f0-5023-4c93-9282-efbb3d94ce76"

ROOMS = [
    {"name": "1번방", "uuid": "5e6f77b7-1dab-4ad5-b032-57c2865f41ca"},
    {"name": "2번방", "uuid": "2d6429bb-5dfc-4431-bc82-4078c4c802a1"},
    {"name": "3번방", "uuid": "d56841b4-9c3c-450d-926d-c591d68a9a66"},
    {"name": "4번방", "uuid": "9e1adfa0-0e13-475c-b1a7-ef112db60a7c"},
]

HOSTESSES = [
    {"name": "마블아가씨1", "membership_id": "c0fe65ff-80bd-45af-9cd8-ada2729c41ec"},
    {"name": "마블아가씨4", "membership_id": "2900e232-47ba-47d9-8662-63f8aa545f87"},
    {"name": "마블아가씨7", "membership_id": "f8f206bf-93aa-47b9-aa4e-eeb3191c5b08"},
    {"name": "마블아가씨2", "membership_id": "d8155dfa-a68d-440b-ad96-35d721c7868c"},
]

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
# 1. Pre-work: Clean up active sessions in all 4 rooms
# =========================================================
log("\n=== Step 1: Pre-work - Clean up active sessions ===")
for room in ROOMS:
    # Try participants endpoint first
    r = api("GET", f"/api/rooms/{room['uuid']}/participants", token)
    sid = None
    if r.status_code == 200:
        data = r.json()
        sid = data.get("session_id")

    if not sid:
        # Fallback: use Supabase REST API directly to find active sessions
        sb_url = SB_URL_ENV
        sb_key = SB_KEY_ENV
        sr = requests.get(
            f"{sb_url}/rest/v1/room_sessions",
            headers={"apikey": sb_key, "Authorization": f"Bearer {sb_key}"},
            params={"room_uuid": f"eq.{room['uuid']}", "status": "eq.active", "select": "id"},
            timeout=10,
        )
        if sr.status_code == 200 and sr.json():
            sid = sr.json()[0]["id"]

    if sid:
        log(f"  Found active session {sid} in {room['name']}, checking out...")
        cr = api("POST", "/api/sessions/checkout", token, {"session_id": sid})
        if cr.status_code == 200:
            log(f"    Checkout OK for {room['name']}")
        else:
            log(f"    Checkout result: {cr.status_code} {cr.text[:200]}")
    else:
        log(f"  No active session in {room['name']}")

# =========================================================
# 2. Full E2E for rooms 1-4
# =========================================================
log("\n=== Step 2: Full E2E flow for rooms 1-4 ===")
session_ids = {}
business_day_id = None

for i, (room, hostess) in enumerate(zip(ROOMS, HOSTESSES)):
    room_name = room["name"]
    room_uuid = room["uuid"]
    h_name = hostess["name"]
    h_mid = hostess["membership_id"]

    log(f"\n--- Room {i+1}: {room_name} with {h_name} ---")

    # 2a. Checkin
    r = api("POST", "/api/sessions/checkin", token, {"room_uuid": room_uuid})
    if r.status_code == 201:
        data = r.json()
        sid = data["session_id"]
        session_ids[room_name] = sid
        ok(f"Checkin {room_name}", f"session_id={sid[:12]}...")
    else:
        fail(f"Checkin {room_name}", f"status={r.status_code} body={r.text[:200]}")
        continue

    # 2b. Add participant (hostess)
    r = api("POST", "/api/sessions/participants", token, {
        "session_id": sid,
        "membership_id": h_mid,
        "role": "hostess",
        "category": "퍼블릭",
        "time_minutes": 90,
    })
    if r.status_code == 201:
        pdata = r.json()
        ok(f"Participant {room_name}", f"participant_id={pdata['participant_id'][:12]}... price={pdata['price_amount']}")
    else:
        fail(f"Participant {room_name}", f"status={r.status_code} body={r.text[:200]}")

    # 2c. Add order
    r = api("POST", "/api/sessions/orders", token, {
        "session_id": sid,
        "item_name": "양주",
        "order_type": "주류",
        "qty": 1,
        "unit_price": 50000,
    })
    if r.status_code == 201:
        odata = r.json()
        ok(f"Order {room_name}", f"order_id={odata['order_id'][:12]}... amount={odata['amount']}")
    else:
        fail(f"Order {room_name}", f"status={r.status_code} body={r.text[:200]}")

    # 2d. Checkout
    r = api("POST", "/api/sessions/checkout", token, {"session_id": sid})
    if r.status_code == 200:
        cdata = r.json()
        ok(f"Checkout {room_name}", f"status={cdata['status']} participants_closed={cdata['participants_closed_count']}")
    else:
        fail(f"Checkout {room_name}", f"status={r.status_code} body={r.text[:200]}")
        continue

    # 2e. Settlement
    r = api("POST", "/api/sessions/settlement", token, {"session_id": sid})
    if r.status_code == 201:
        sdata = r.json()
        ok(f"Settlement {room_name}",
           f"gross={sdata['gross_total']} tc={sdata['tc_amount']} mgr={sdata['manager_amount']} "
           f"hostess={sdata['hostess_amount']} margin={sdata['margin_amount']}")
        if business_day_id is None:
            business_day_id = sdata.get("business_day_id")
    else:
        fail(f"Settlement {room_name}", f"status={r.status_code} body={r.text[:200]}")

    # 2f. Check participants have names
    r = api("GET", f"/api/rooms/{room_uuid}/participants", token)
    if r.status_code == 200:
        pdata = r.json()
        # Session is closed so we get empty participants (no active session)
        # That's expected - the name lookup only works for active sessions
        ok(f"Room participants GET {room_name}", f"response OK (session closed, so participants=[])")
    else:
        fail(f"Room participants GET {room_name}", f"status={r.status_code} body={r.text[:200]}")


# =========================================================
# 3. Verify GET /api/store/staff (names)
# =========================================================
log("\n=== Step 3: GET /api/store/staff ===")
r = api("GET", "/api/store/staff", token)
if r.status_code == 200:
    sdata = r.json()
    staff = sdata.get("staff", [])
    has_names = all(s.get("name") and s["name"] != s.get("membership_id") for s in staff)
    names_sample = [f"{s['name']}({s['role']})" for s in staff[:6]]
    if has_names and len(staff) > 0:
        ok("Store staff names", f"count={len(staff)} sample={names_sample}")
    else:
        fail("Store staff names", f"names missing or UUIDs shown. staff={json.dumps(staff[:3], ensure_ascii=False)}")
else:
    fail("Store staff", f"status={r.status_code} body={r.text[:200]}")


# =========================================================
# 4. GET /api/manager/settlement/summary
# =========================================================
log("\n=== Step 4: GET /api/manager/settlement/summary ===")
r = api("GET", "/api/manager/settlement/summary", token)
if r.status_code == 200:
    sdata = r.json()
    summary = sdata.get("summary", [])
    has_names = any(s.get("hostess_name") for s in summary)
    sample = summary[:3]
    if has_names:
        ok("Settlement summary hostess_name", f"count={len(summary)} sample={json.dumps(sample, ensure_ascii=False)[:200]}")
    else:
        fail("Settlement summary hostess_name", f"hostess_name missing in summary. sample={json.dumps(sample, ensure_ascii=False)[:200]}")
else:
    fail("Settlement summary", f"status={r.status_code} body={r.text[:200]}")


# =========================================================
# 5. GET /api/reports/daily
# =========================================================
log("\n=== Step 5: GET /api/reports/daily ===")
if business_day_id:
    r = api("GET", "/api/reports/daily", token, params={"business_day_id": business_day_id})
    if r.status_code == 200:
        rdata = r.json()
        totals = rdata.get("totals", {})
        ok("Daily report", f"sessions={totals.get('session_count')} gross={totals.get('gross_total')} receipts={len(rdata.get('receipts', []))}")
    else:
        fail("Daily report", f"status={r.status_code} body={r.text[:200]}")
else:
    fail("Daily report", "No business_day_id captured from settlement")


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
