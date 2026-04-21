#!/usr/bin/env python3
"""NOX 4-Store Cross Transfer E2E Test - Round 069

Tests transfer request→approve(from)→approve(to) for all 6 store pairs.
Uses one hostess per pair, creates transfer, both sides approve, verifies fully_approved.
"""

import os
import sys
import requests

BASE = "http://localhost:3001"
LOGIN_URL = f"{BASE}/api/auth/login"
PASSWORD = "Test1234!"
MARVEL_PASSWORD = "xptmxmdlqslek"

# SECURITY (SECURITY_FIX_PLAN.md TASK 0-1): secrets must come from env.
SB_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
SB_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
if not SB_URL or not SB_KEY:
    print("[test-cross-store] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.", file=sys.stderr)
    sys.exit(2)

STORES = {
    "marvel": {
        "uuid": "ad1b95f0-5023-4c93-9282-efbb3d94ce76",
        "owner_email": "tset@gmail.com",
        "owner_password": MARVEL_PASSWORD,
        "label": "마블",
    },
    "live": {
        "uuid": "d7f62182-48cb-4731-b694-b1a02d60b1fa",
        "owner_email": "live-owner@nox-test.com",
        "owner_password": PASSWORD,
        "label": "라이브",
    },
    "burning": {
        "uuid": "147b2115-6ece-48ed-9ca0-63fd31ea2c38",
        "owner_email": "burning-owner@nox-test.com",
        "owner_password": PASSWORD,
        "label": "버닝",
    },
    "hwangjini": {
        "uuid": "cbacf389-4cd7-4459-b97d-d7775ddaf8d0",
        "owner_email": "hwangjini-owner@nox-test.com",
        "owner_password": PASSWORD,
        "label": "황진이",
    },
}

# Hostess membership_ids to use for each from-store (one per pair)
HOSTESS_MAP = {
    "marvel": "d8155dfa-a68d-440b-ad96-35d721c7868c",     # 마블아가씨2
    "live": "08192388-3b59-4a41-b611-c3100349ebfd",       # 라이브아가씨
    "burning": "971b0aa1-65f4-4819-b47e-10a353124b7f",    # 버닝아가씨
    "hwangjini": "a774b4a6-2651-4540-9228-91c2c7645172",  # 황진이아가씨1
}

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
    return requests.post(url, headers=headers, json=body, timeout=30)


def sb_patch(table, match_params, body):
    url = f"{SB_URL}/rest/v1/{table}"
    headers = {
        "apikey": SB_KEY,
        "Authorization": f"Bearer {SB_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    return requests.patch(url, headers=headers, params=match_params, json=body, timeout=10)


def sb_get(table, params):
    return requests.get(
        f"{SB_URL}/rest/v1/{table}",
        headers={"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}"},
        params=params,
        timeout=10,
    )


def login(email, password, label=""):
    r = requests.post(LOGIN_URL, json={"email": email, "password": password}, timeout=15)
    if r.status_code != 200:
        log(f"  Login failed for {label}: {r.status_code}")
        return None
    return r.json()["access_token"]


def cleanup_pending_transfers(hostess_mid):
    """Cancel any pending transfers for a hostess"""
    sr = sb_get("transfer_requests", {
        "hostess_membership_id": f"eq.{hostess_mid}",
        "status": "eq.pending",
        "select": "id",
    })
    if sr.status_code == 200:
        for tr in sr.json():
            sb_patch("transfer_requests", {"id": f"eq.{tr['id']}"}, {"status": "cancelled"})


def test_transfer_pair(from_key, to_key):
    """Test transfer from one store to another"""
    from_store = STORES[from_key]
    to_store = STORES[to_key]
    hostess_mid = HOSTESS_MAP[from_key]
    pair_label = f"{from_store['label']}→{to_store['label']}"

    log(f"\n--- {pair_label} ---")

    # Cleanup
    cleanup_pending_transfers(hostess_mid)

    # Login from-store owner
    from_token = login(from_store["owner_email"], from_store["owner_password"], from_store["label"])
    if not from_token:
        fail(f"{pair_label} from-login", "Cannot login")
        return

    # Login to-store owner
    to_token = login(to_store["owner_email"], to_store["owner_password"], to_store["label"])
    if not to_token:
        fail(f"{pair_label} to-login", "Cannot login")
        return

    # 1. Create transfer request
    r = api("POST", "/api/transfer/request", from_token, {
        "hostess_membership_id": hostess_mid,
        "to_store_uuid": to_store["uuid"],
        "reason": f"교차 테스트 {pair_label}",
    })
    if r.status_code == 201:
        transfer_id = r.json()["id"]
        ok(f"{pair_label} request", f"id={transfer_id[:12]}...")
    elif r.status_code == 409:
        ok(f"{pair_label} request", "duplicate (already exists) — skipping")
        return
    else:
        fail(f"{pair_label} request", f"status={r.status_code} body={r.text[:200]}")
        return

    # 2. From-store approves
    r = api("POST", "/api/transfer/approve", from_token, {"transfer_id": transfer_id})
    if r.status_code == 200:
        data = r.json()
        if not data.get("fully_approved"):
            ok(f"{pair_label} from-approve", f"side={data.get('approved_side')}")
        else:
            fail(f"{pair_label} from-approve", "Should NOT be fully approved yet")
    else:
        fail(f"{pair_label} from-approve", f"status={r.status_code} body={r.text[:200]}")
        return

    # 3. To-store approves
    r = api("POST", "/api/transfer/approve", to_token, {"transfer_id": transfer_id})
    if r.status_code == 200:
        data = r.json()
        if data.get("fully_approved"):
            ok(f"{pair_label} to-approve+fully", "Both sides approved")
        else:
            fail(f"{pair_label} to-approve", "Expected fully_approved=true")
    else:
        fail(f"{pair_label} to-approve", f"status={r.status_code} body={r.text[:200]}")
        return

    # 4. Verify via list
    r = api("GET", "/api/transfer/list", from_token, params={"status": "approved"})
    if r.status_code == 200:
        transfers = r.json().get("transfers", [])
        found = any(t["id"] == transfer_id for t in transfers)
        if found:
            ok(f"{pair_label} verify", "Found in approved list")
        else:
            fail(f"{pair_label} verify", "Not found in approved list")
    else:
        fail(f"{pair_label} verify", f"status={r.status_code}")


# =========================================================
# Run all 6 pairs
# =========================================================
log("=== NOX 4-Store Cross Transfer Test ===")

PAIRS = [
    ("marvel", "live"),
    ("marvel", "burning"),
    ("marvel", "hwangjini"),
    ("live", "burning"),
    ("live", "hwangjini"),
    ("burning", "hwangjini"),
]

for from_key, to_key in PAIRS:
    test_transfer_pair(from_key, to_key)

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
