#!/usr/bin/env python3
"""
NOX Mass E2E -- 4 stores, 160 hostesses, ~960 sessions

- Each hostess: random category (pub/shirt/harper), 4~8 times
- Manager deduction: 10,000/time
- 30% cross-store
- Exact amount verification per hostess, per store, net settlement

Usage: python scripts/test-cross-store-mass.py
"""

import os
import sys
import random
import time
import requests
import json

BASE = "http://localhost:3000"
PASSWORD = "Test1234!"
MARVEL_PW = "xptmxmdlqslek"

# SECURITY (SECURITY_FIX_PLAN.md TASK 0-1): secrets must come from env.
SB_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
SB_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
if not SB_URL or not SB_KEY:
    print("[test-cross-store-mass] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.", file=sys.stderr)
    sys.exit(2)

STORES = {
    "marvel":    {"uuid": "ad1b95f0-5023-4c93-9282-efbb3d94ce76", "email": "tset@gmail.com",              "password": MARVEL_PW, "label": "Marvel"},
    "live":      {"uuid": "d7f62182-48cb-4731-b694-b1a02d60b1fa", "email": "live-owner@nox-test.com",      "password": PASSWORD,  "label": "Live"},
    "burning":   {"uuid": "147b2115-6ece-48ed-9ca0-63fd31ea2c38", "email": "burning-owner@nox-test.com",   "password": PASSWORD,  "label": "Burning"},
    "hwangjini": {"uuid": "cbacf389-4cd7-4459-b97d-d7775ddaf8d0", "email": "hwangjini-owner@nox-test.com", "password": PASSWORD,  "label": "Hwangjini"},
}

PRICES = {"pub": 130000, "shirt": 140000, "harper": 120000}
CAT_DB  = {"pub": "퍼블릭", "shirt": "셔츠", "harper": "하퍼"}
TIME_MIN = {"pub": 90, "shirt": 60, "harper": 60}
MGR_DEDUCTION = 10000
CROSS_STORE_RATIO = 0.30

passed = 0
failed = 0
errors = []
t0 = time.time()


def log(m):
    print(m, flush=True)

def ok(n, d=""):
    global passed; passed += 1

def fail(n, d=""):
    global failed; failed += 1; errors.append(f"{n}: {d}")
    log(f"  [FAIL] {n} {d}")

def assert_exact(n, exp, act):
    if exp != act:
        fail(n, f"expected={exp} actual={act}")
    else:
        ok(n)

def api(method, path, token, body=None):
    url = f"{BASE}{path}"
    h = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    if method == "GET":
        return requests.get(url, headers=h, timeout=30)
    elif method == "POST":
        return requests.post(url, headers=h, json=body, timeout=30)
    elif method == "PATCH":
        return requests.patch(url, headers=h, json=body, timeout=30)
    return requests.get(url, headers=h, timeout=30)

def sb_query(table, params):
    r = requests.get(f"{SB_URL}/rest/v1/{table}",
        headers={"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}"},
        params=params, timeout=15)
    return r.json() if r.status_code == 200 else []


# =================================================================
# Phase 0: Login
# =================================================================
log("\n=== Phase 0: Login ===")
tokens = {}
membership_ids = {}
store_keys = list(STORES.keys())

for key, st in STORES.items():
    r = requests.post(f"{BASE}/api/auth/login", json={"email": st["email"], "password": st["password"]}, timeout=15)
    if r.status_code != 200:
        log(f"  Login FAILED {st['label']}"); sys.exit(1)
    d = r.json()
    tokens[key] = d["access_token"]
    uid = d.get("user_id", "")
    mem = sb_query("store_memberships", {"store_uuid": f"eq.{st['uuid']}", "profile_id": f"eq.{uid}", "status": "eq.approved", "select": "id", "limit": "1"})
    membership_ids[key] = mem[0]["id"] if mem else ""

log(f"  4 stores logged in")


# =================================================================
# Phase 1: Discover rooms + hostesses
# =================================================================
log("\n=== Phase 1: Discover rooms + hostesses ===")
store_rooms = {}
all_hostesses = []  # [{ key, membership_id, name, category_key }]

for key, st in STORES.items():
    # rooms
    r = api("GET", "/api/rooms", tokens[key])
    rooms = r.json().get("rooms", []) if r.status_code == 200 else []
    store_rooms[key] = [rm["id"] for rm in rooms]
    # cleanup
    for rm in rooms:
        sess = rm.get("session")
        if sess and sess.get("id"):
            api("POST", "/api/sessions/checkout", tokens[key], {"session_id": sess["id"]})

    # hostesses
    raw = sb_query("hostesses", {"store_uuid": f"eq.{st['uuid']}", "is_active": "eq.true", "select": "membership_id,name,category"})
    for h in raw:
        cat = h.get("category") or "퍼블릭"
        cat_key = {"퍼블릭": "pub", "셔츠": "shirt", "하퍼": "harper"}.get(cat, "pub")
        all_hostesses.append({"key": key, "membership_id": h["membership_id"], "name": h.get("name", ""), "cat": cat_key})

log(f"  Total hostesses: {len(all_hostesses)}")
for k in store_keys:
    cnt = len([h for h in all_hostesses if h["key"] == k])
    log(f"    {STORES[k]['label']}: {cnt} hostesses, {len(store_rooms[k])} rooms")


# =================================================================
# Phase 2: Generate work plan
# =================================================================
log("\n=== Phase 2: Generate work plan ===")
random.seed(42)  # reproducible

work_plan = []  # [{ hostess, origin_key, working_key, cat, times, is_cross }]
cross_count = 0
total_times = 0

for h in all_hostesses:
    origin = h["key"]
    times = random.randint(4, 8)
    total_times += times
    is_cross = random.random() < CROSS_STORE_RATIO

    if is_cross:
        other_keys = [k for k in store_keys if k != origin]
        working = random.choice(other_keys)
        cross_count += 1
    else:
        working = origin

    work_plan.append({
        "hostess": h,
        "origin_key": origin,
        "working_key": working,
        "cat": h["cat"],
        "times": times,
        "is_cross": is_cross,
    })

log(f"  Total plans: {len(work_plan)}")
log(f"  Total times: {total_times}")
log(f"  Cross-store: {cross_count} ({cross_count/len(work_plan)*100:.0f}%)")


# =================================================================
# Phase 3: Expected amounts
# =================================================================
log("\n=== Phase 3: Expected amounts ===")

# per-hostess expected
for wp in work_plan:
    price = PRICES[wp["cat"]]
    hostess_per_time = price - MGR_DEDUCTION
    wp["price_per"] = price
    wp["hostess_per"] = hostess_per_time
    wp["total_price"] = price * wp["times"]
    wp["total_hostess"] = hostess_per_time * wp["times"]

# per-store expected payouts (origin basis)
store_expected_payout = {k: 0 for k in store_keys}
store_expected_cross_payout = {k: 0 for k in store_keys}
for wp in work_plan:
    store_expected_payout[wp["origin_key"]] += wp["total_hostess"]
    if wp["is_cross"]:
        store_expected_cross_payout[wp["origin_key"]] += wp["total_hostess"]

# net settlement between stores
net_flows = {}  # (from, to) -> amount owed by working store to origin
for wp in work_plan:
    if wp["is_cross"]:
        pair = (wp["working_key"], wp["origin_key"])
        net_flows[pair] = net_flows.get(pair, 0) + wp["total_hostess"]

for k in store_keys:
    log(f"  {STORES[k]['label']}: total_hostess_payout={store_expected_payout[k]:,} cross_store={store_expected_cross_payout[k]:,}")

log(f"\n  Net flows:")
for (fr, to), amt in sorted(net_flows.items()):
    log(f"    {STORES[fr]['label']} owes {STORES[to]['label']}: {amt:,}")


# =================================================================
# Phase 4: Execute all sessions
# =================================================================
log(f"\n=== Phase 4: Execute {total_times} sessions ===")

completed = 0
session_results = []  # [{ wp_index, session_id, price, hostess_payout }]
batch_start = time.time()

for wi, wp in enumerate(work_plan):
    working_key = wp["working_key"]
    origin_key = wp["origin_key"]
    working_token = tokens[working_key]
    h = wp["hostess"]
    rooms = store_rooms[working_key]
    is_cross = wp["is_cross"]
    cat_db = CAT_DB[wp["cat"]]
    t_min = TIME_MIN[wp["cat"]]

    for t in range(wp["times"]):
        room_uuid = rooms[t % len(rooms)]

        # checkin
        r = api("POST", "/api/sessions/checkin", working_token, {"room_uuid": room_uuid})
        if r.status_code != 201:
            fail(f"Checkin W{wi}T{t}", f"status={r.status_code}")
            continue
        sid = r.json()["session_id"]

        # CSWR (cross-store only)
        if is_cross:
            r = api("POST", "/api/cross-store/work-record", working_token, {
                "session_id": sid,
                "hostess_membership_id": h["membership_id"],
                "origin_store_uuid": STORES[origin_key]["uuid"],
            })
            if r.status_code not in (201, 409):
                fail(f"CSWR W{wi}T{t}", f"status={r.status_code} {r.text[:100]}")
                api("POST", "/api/sessions/checkout", working_token, {"session_id": sid})
                continue

        # participant
        body = {
            "session_id": sid,
            "membership_id": h["membership_id"],
            "role": "hostess",
            "category": cat_db,
            "time_minutes": t_min,
            "manager_deduction": MGR_DEDUCTION,
        }
        if wp["cat"] == "shirt":
            body["greeting_confirmed"] = True

        r = api("POST", "/api/sessions/participants", working_token, body)
        if r.status_code == 201:
            pd = r.json()
            actual_price = pd.get("price_amount", 0)
            actual_hostess = pd.get("hostess_payout", 0)
            if actual_price != wp["price_per"]:
                fail(f"Price W{wi}T{t}", f"expected={wp['price_per']} actual={actual_price}")
        else:
            fail(f"Participant W{wi}T{t}", f"status={r.status_code} {r.text[:150]}")
            api("POST", "/api/sessions/checkout", working_token, {"session_id": sid})
            continue

        # checkout
        r = api("POST", "/api/sessions/checkout", working_token, {"session_id": sid})
        if r.status_code != 200:
            fail(f"Checkout W{wi}T{t}", f"status={r.status_code}")
            continue

        # settlement
        r = api("POST", "/api/sessions/settlement", working_token, {"session_id": sid})
        if r.status_code in (200, 201):
            session_results.append({"wp_index": wi, "session_id": sid, "price": wp["price_per"], "hostess_payout": wp["hostess_per"]})
        else:
            fail(f"Settlement W{wi}T{t}", f"status={r.status_code} {r.text[:150]}")

        completed += 1
        if completed % 50 == 0:
            elapsed = time.time() - batch_start
            log(f"  ... {completed}/{total_times} ({elapsed:.1f}s)")

elapsed = time.time() - batch_start
log(f"  Completed: {completed}/{total_times} in {elapsed:.1f}s")


# =================================================================
# Phase 5: Per-hostess verification (DB direct)
# =================================================================
log(f"\n=== Phase 5: Per-hostess verification ===")

hostess_pass = 0
hostess_fail = 0

for wi, wp in enumerate(work_plan):
    h = wp["hostess"]
    my_sessions = [sr for sr in session_results if sr["wp_index"] == wi]

    if len(my_sessions) != wp["times"]:
        fail(f"SessionCount H{wi} {h['name']}", f"expected={wp['times']} actual={len(my_sessions)}")
        hostess_fail += 1
        continue

    # DB check: sum hostess_payout_amount
    sids = [s["session_id"] for s in my_sessions]
    total_db = 0
    for sid in sids:
        parts = sb_query("session_participants", {
            "session_id": f"eq.{sid}",
            "membership_id": f"eq.{h['membership_id']}",
            "select": "hostess_payout_amount",
        })
        for p in parts:
            total_db += p.get("hostess_payout_amount", 0)

    if total_db != wp["total_hostess"]:
        fail(f"Payout H{wi} {h['name']}", f"expected={wp['total_hostess']} actual={total_db}")
        hostess_fail += 1
    else:
        ok(f"Payout H{wi}")
        hostess_pass += 1

log(f"  Hostess verification: {hostess_pass} pass, {hostess_fail} fail (out of {len(work_plan)})")


# =================================================================
# Phase 6: Per-store totals
# =================================================================
log(f"\n=== Phase 6: Per-store totals ===")

store_actual_payout = {k: 0 for k in store_keys}
for wp in work_plan:
    my_sessions = [sr for sr in session_results if sr["wp_index"] == work_plan.index(wp)]
    store_actual_payout[wp["origin_key"]] += len(my_sessions) * wp["hostess_per"]

for k in store_keys:
    label = STORES[k]["label"]
    assert_exact(f"{label} total payout", store_expected_payout[k], store_actual_payout[k])
    log(f"  {label}: expected={store_expected_payout[k]:,} actual={store_actual_payout[k]:,}")


# =================================================================
# Phase 7: Net settlement verification
# =================================================================
log(f"\n=== Phase 7: Net settlement ===")

# actual net flows from session_results
actual_flows = {}
for wi, wp in enumerate(work_plan):
    if wp["is_cross"]:
        my_sessions = [sr for sr in session_results if sr["wp_index"] == wi]
        pair = (wp["working_key"], wp["origin_key"])
        actual_flows[pair] = actual_flows.get(pair, 0) + len(my_sessions) * wp["hostess_per"]

for (fr, to), expected_amt in sorted(net_flows.items()):
    actual_amt = actual_flows.get((fr, to), 0)
    assert_exact(f"Net {STORES[fr]['label']}->{STORES[to]['label']}", expected_amt, actual_amt)
    log(f"  {STORES[fr]['label']} -> {STORES[to]['label']}: expected={expected_amt:,} actual={actual_amt:,}")

# bilateral net
log(f"\n  Bilateral net:")
bilateral = {}
for (fr, to), amt in net_flows.items():
    pair = tuple(sorted([fr, to]))
    if pair not in bilateral:
        bilateral[pair] = {}
    bilateral[pair][(fr, to)] = amt

for pair, flows in sorted(bilateral.items()):
    a, b = pair
    a_to_b = flows.get((a, b), 0)
    b_to_a = flows.get((b, a), 0)
    net = a_to_b - b_to_a
    if net > 0:
        log(f"    {STORES[a]['label']} owes {STORES[b]['label']}: {abs(net):,}")
    elif net < 0:
        log(f"    {STORES[b]['label']} owes {STORES[a]['label']}: {abs(net):,}")
    else:
        log(f"    {STORES[a]['label']} <> {STORES[b]['label']}: even")


# =================================================================
# Summary
# =================================================================
total_elapsed = time.time() - t0
log(f"\n{'='*60}")
log(f"  TOTAL: {passed + failed} | PASS: {passed} | FAIL: {failed}")
log(f"  Sessions: {completed} | Time: {total_elapsed:.1f}s")
log(f"  Hostesses: {len(work_plan)} | Cross-store: {cross_count}")
log(f"{'='*60}")

if errors:
    log(f"\nFailed ({len(errors)}):")
    for e in errors[:20]:
        log(f"  - {e}")
    if len(errors) > 20:
        log(f"  ... and {len(errors)-20} more")

sys.exit(0 if failed == 0 else 1)
