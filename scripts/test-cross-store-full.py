#!/usr/bin/env python3
"""
NOX 교차검증 E2E — 4매장 타매장 정산 풀 시나리오

시나리오:
  - 마블 아가씨 -> 라이브에서 퍼블릭 3타임 (39만원 귀속: 마블)
  - 라이브 아가씨 -> 마블에서 퍼블릭 1타임 (13만원 귀속: 라이브)
  - 버닝 아가씨 -> 황진이에서 셔츠 2타임 (28만원 귀속: 버닝)
  - 선정산 포함 (퇴근 전 담당실장 요청)
  - 교차 net settlement: 마블<->라이브 39-13=26만 마블 수령
  - 0.1% 오차도 허용 안 함

Usage: python scripts/test-cross-store-full.py
"""

import os
import sys
import random
import requests

BASE = "http://localhost:3000"
PASSWORD = "Test1234!"
MARVEL_PASSWORD = "xptmxmdlqslek"

# SECURITY (SECURITY_FIX_PLAN.md TASK 0-1): secrets must come from env.
SB_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
SB_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
if not SB_URL or not SB_KEY:
    print("[test-cross-store-full] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.", file=sys.stderr)
    sys.exit(2)

STORES = {
    "marvel": {
        "uuid": "ad1b95f0-5023-4c93-9282-efbb3d94ce76",
        "email": "tset@gmail.com",
        "password": MARVEL_PASSWORD,
        "label": "마블",
    },
    "live": {
        "uuid": "d7f62182-48cb-4731-b694-b1a02d60b1fa",
        "email": "live-owner@nox-test.com",
        "password": PASSWORD,
        "label": "라이브",
    },
    "burning": {
        "uuid": "147b2115-6ece-48ed-9ca0-63fd31ea2c38",
        "email": "burning-owner@nox-test.com",
        "password": PASSWORD,
        "label": "버닝",
    },
    "hwangjini": {
        "uuid": "cbacf389-4cd7-4459-b97d-d7775ddaf8d0",
        "email": "hwangjini-owner@nox-test.com",
        "password": PASSWORD,
        "label": "황진이",
    },
}

# 종목별 기본 단가 (DB 기준, 검증용)
PRICES = {
    ("퍼블릭", "기본"): 130000,
    ("셔츠", "기본"): 140000,
    ("하퍼", "기본"): 120000,
}

passed = 0
failed = 0
errors = []


def log(msg):
    print(msg, flush=True)


def ok(name, detail=""):
    global passed
    passed += 1
    log(f"  [PASS] {name} {detail}")


def fail(name, detail=""):
    global failed
    failed += 1
    errors.append(f"{name}: {detail}")
    log(f"  [FAIL] {name} {detail}")
    log(f"  *** STOPPING - mismatch detected ***")
    report()
    sys.exit(1)


def assert_exact(name, expected, actual):
    if expected != actual:
        fail(name, f"expected={expected} actual={actual}")
    else:
        ok(name, f"{actual}")


def api(method, path, token, body=None, params=None):
    url = f"{BASE}{path}"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    if method == "GET":
        return requests.get(url, headers=headers, params=params, timeout=30)
    elif method == "POST":
        return requests.post(url, headers=headers, json=body, timeout=30)
    elif method == "PATCH":
        return requests.patch(url, headers=headers, json=body, timeout=30)
    return requests.get(url, headers=headers, timeout=30)


def sb_query(table, params):
    """Supabase REST API 직접 조회"""
    r = requests.get(
        f"{SB_URL}/rest/v1/{table}",
        headers={"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}"},
        params=params,
        timeout=15,
    )
    return r.json() if r.status_code == 200 else []


def report():
    log(f"\n{'='*60}")
    log(f"  TOTAL: {passed + failed} | PASS: {passed} | FAIL: {failed}")
    log(f"{'='*60}")
    if errors:
        log("\nFailed tests:")
        for e in errors:
            log(f"  - {e}")


# =================================================================
# Phase 0: Login all stores
# =================================================================
log("\n=== Phase 0: Login all 4 stores ===")
tokens = {}
membership_ids = {}

for key, store in STORES.items():
    r = requests.post(f"{BASE}/api/auth/login", json={
        "email": store["email"], "password": store["password"]
    }, timeout=15)
    if r.status_code != 200:
        fail(f"Login {store['label']}", f"status={r.status_code}")
    data = r.json()
    tokens[key] = data["access_token"]
    user_id = data.get("user_id", "")

    # login 응답에 membership_id가 없으므로 Supabase에서 직접 조회
    mem_rows = sb_query("store_memberships", {
        "store_uuid": f"eq.{store['uuid']}",
        "profile_id": f"eq.{user_id}",
        "status": "eq.approved",
        "select": "id",
        "limit": "1",
    })
    membership_ids[key] = mem_rows[0]["id"] if mem_rows else ""
    ok(f"Login {store['label']}", f"membership_id={membership_ids[key][:12]}..." if membership_ids[key] else "NO_MEMBERSHIP")


# =================================================================
# Phase 1: Discover staff (Supabase direct query)
# =================================================================
log("\n=== Phase 1: Discover staff per store ===")

store_staff = {}  # key -> { managers: [...], hostesses: { 퍼블릭: [...], 셔츠: [...], 하퍼: [...] } }

for key, store in STORES.items():
    suuid = store["uuid"]

    # Managers
    managers_raw = sb_query("store_memberships", {
        "store_uuid": f"eq.{suuid}", "role": "eq.manager", "status": "eq.approved",
        "select": "id", "limit": "10",
    })
    mgr_ids = [m["id"] for m in managers_raw]

    # Hostesses with category from hostesses table
    hostesses_raw = sb_query("hostesses", {
        "store_uuid": f"eq.{suuid}", "is_active": "eq.true",
        "select": "membership_id,name,category",
    })

    h_by_cat = {"퍼블릭": [], "셔츠": [], "하퍼": []}
    for h in hostesses_raw:
        cat = h.get("category") or "퍼블릭"
        if cat in h_by_cat:
            h_by_cat[cat].append({"membership_id": h["membership_id"], "name": h.get("name", "")})

    store_staff[key] = {"managers": mgr_ids, "hostesses": h_by_cat}

    total_h = sum(len(v) for v in h_by_cat.values())
    log(f"  {store['label']}: managers={len(mgr_ids)} hostesses={total_h} (퍼={len(h_by_cat['퍼블릭'])} 셔={len(h_by_cat['셔츠'])} 하={len(h_by_cat['하퍼'])})")


# =================================================================
# Phase 2: Discover rooms + cleanup
# =================================================================
log("\n=== Phase 2: Discover rooms + cleanup ===")
store_rooms = {}  # key -> [room_uuid, ...]

for key in STORES:
    r = api("GET", "/api/rooms", tokens[key])
    rooms = r.json().get("rooms", []) if r.status_code == 200 else []
    room_uuids = [rm["id"] for rm in rooms]
    store_rooms[key] = room_uuids

    # cleanup active sessions
    for rm in rooms:
        sess = rm.get("session")
        sid = sess.get("id") if sess else None
        if sid:
            api("POST", "/api/sessions/checkout", tokens[key], {"session_id": sid})
            log(f"  Cleaned {STORES[key]['label']} {rm.get('room_name', '')} session={sid[:8]}...")

    log(f"  {STORES[key]['label']}: {len(room_uuids)} rooms")


# =================================================================
# Phase 3: Random attendance assignment
# =================================================================
log("\n=== Phase 3: Random attendance (출근 배정) ===")
attendance = {}  # key -> { managers: [subset], hostesses: { cat: [subset] } }

for key in STORES:
    staff = store_staff[key]
    n_mgr = min(len(staff["managers"]), random.randint(3, min(10, len(staff["managers"]))))
    sel_mgr = random.sample(staff["managers"], n_mgr) if n_mgr > 0 else []

    sel_h = {}
    for cat in ["퍼블릭", "셔츠", "하퍼"]:
        pool = staff["hostesses"][cat]
        n = min(len(pool), random.randint(2, min(10, len(pool)))) if pool else 0
        sel_h[cat] = random.sample(pool, n) if n > 0 else []

    attendance[key] = {"managers": sel_mgr, "hostesses": sel_h}
    total_h = sum(len(v) for v in sel_h.values())
    log(f"  {STORES[key]['label']}: managers={len(sel_mgr)} hostesses={total_h}")


# =================================================================
# Phase 4: Cross-store work records
# =================================================================
log("\n=== Phase 4: Cross-store work records ===")

# Pick specific hostesses for cross-store
def pick_hostess(store_key, category):
    pool = store_staff[store_key]["hostesses"].get(category, [])
    if not pool:
        fail(f"No {category} hostess in {STORES[store_key]['label']}")
    return pool[0]


cross_scenarios = []

# 마블 아가씨 -> 라이브에서 퍼블릭 3타임
marvel_h = pick_hostess("marvel", "퍼블릭")
cross_scenarios.append({
    "hostess": marvel_h,
    "origin": "marvel",
    "working": "live",
    "category": "퍼블릭",
    "times": 3,
    "price_per": PRICES[("퍼블릭", "기본")],
    "expected_total": 3 * PRICES[("퍼블릭", "기본")],  # 390000
    "pre_settlement": 50000,
})

# 라이브 아가씨 -> 마블에서 퍼블릭 1타임
live_h = pick_hostess("live", "퍼블릭")
cross_scenarios.append({
    "hostess": live_h,
    "origin": "live",
    "working": "marvel",
    "category": "퍼블릭",
    "times": 1,
    "price_per": PRICES[("퍼블릭", "기본")],
    "expected_total": 1 * PRICES[("퍼블릭", "기본")],  # 130000
    "pre_settlement": 0,
})

# 버닝 아가씨 -> 황진이에서 셔츠 2타임
burning_h = pick_hostess("burning", "셔츠")
cross_scenarios.append({
    "hostess": burning_h,
    "origin": "burning",
    "working": "hwangjini",
    "category": "셔츠",
    "times": 2,
    "price_per": PRICES[("셔츠", "기본")],
    "expected_total": 2 * PRICES[("셔츠", "기본")],  # 280000
    "pre_settlement": 30000,
})

log(f"  Scenarios: {len(cross_scenarios)}")
for sc in cross_scenarios:
    log(f"    {sc['hostess']['name']} ({STORES[sc['origin']]['label']}->{STORES[sc['working']]['label']}) "
        f"{sc['category']}x{sc['times']} = {sc['expected_total']:,}원 pre={sc['pre_settlement']:,}원")


# =================================================================
# Phase 5: Execute cross-store sessions
# =================================================================
log("\n=== Phase 5: Execute cross-store sessions ===")

scenario_results = []  # { origin, working, hostess, sessions: [{ session_id, participants, settlement }] }

for i, sc in enumerate(cross_scenarios):
    origin_key = sc["origin"]
    working_key = sc["working"]
    working_token = tokens[working_key]
    origin_label = STORES[origin_key]["label"]
    working_label = STORES[working_key]["label"]
    h = sc["hostess"]

    log(f"\n--- Scenario {i+1}: {h['name']} ({origin_label}->{working_label}) ---")

    sessions_data = []

    for t in range(sc["times"]):
        room_uuid = store_rooms[working_key][t % len(store_rooms[working_key])]

        # 5a. Checkin at working store
        r = api("POST", "/api/sessions/checkin", working_token, {"room_uuid": room_uuid})
        if r.status_code != 201:
            fail(f"Checkin S{i+1}T{t+1}", f"status={r.status_code} body={r.text[:200]}")
        sid = r.json()["session_id"]
        ok(f"Checkin S{i+1}T{t+1}", f"session={sid[:8]}...")

        # 5b. Cross-store work record
        r = api("POST", "/api/cross-store/work-record", working_token, {
            "session_id": sid,
            "hostess_membership_id": h["membership_id"],
            "origin_store_uuid": STORES[origin_key]["uuid"],
        })
        if r.status_code == 201:
            ok(f"CSWR S{i+1}T{t+1}")
        elif r.status_code == 409:
            ok(f"CSWR S{i+1}T{t+1} (already exists)")
        else:
            fail(f"CSWR S{i+1}T{t+1}", f"status={r.status_code} body={r.text[:200]}")

        # 5c. Add participant (cross-store hostess)
        time_minutes = 90 if sc["category"] == "퍼블릭" else 60
        participant_body = {
            "session_id": sid,
            "membership_id": h["membership_id"],
            "role": "hostess",
            "category": sc["category"],
            "time_minutes": time_minutes,
        }
        if sc["category"] == "셔츠":
            participant_body["greeting_confirmed"] = True

        r = api("POST", "/api/sessions/participants", working_token, participant_body)
        if r.status_code == 201:
            pdata = r.json()
            actual_price = pdata.get("price_amount", 0)
            assert_exact(f"Price S{i+1}T{t+1}", sc["price_per"], actual_price)
        else:
            fail(f"Participant S{i+1}T{t+1}", f"status={r.status_code} body={r.text[:200]}")

        # 5d. Pre-settlement (first time only)
        pre_sid = None
        if t == 0 and sc["pre_settlement"] > 0:
            mgr_id = membership_ids[working_key]
            r = api("POST", "/api/sessions/pre-settlement", working_token, {
                "session_id": sid,
                "amount": sc["pre_settlement"],
                "requester_membership_id": mgr_id,
                "memo": f"E2E교차선정산 {origin_label}->{working_label}",
            })
            if r.status_code == 201:
                pre_sid = r.json()["id"]
                ok(f"PreSettlement S{i+1}", f"amount={sc['pre_settlement']:,}")
            else:
                fail(f"PreSettlement S{i+1}", f"status={r.status_code} body={r.text[:200]}")

        # 5e. Checkout
        r = api("POST", "/api/sessions/checkout", working_token, {"session_id": sid})
        if r.status_code == 200:
            ok(f"Checkout S{i+1}T{t+1}")
        else:
            fail(f"Checkout S{i+1}T{t+1}", f"status={r.status_code} body={r.text[:200]}")

        # 5f. Settlement
        r = api("POST", "/api/sessions/settlement", working_token, {"session_id": sid})
        if r.status_code in (200, 201):
            sdata = r.json()
            sessions_data.append({
                "session_id": sid,
                "gross_total": sdata["gross_total"],
                "margin_amount": sdata["margin_amount"],
                "pre_settlement_total": sdata.get("pre_settlement_total", 0),
            })
            ok(f"Settlement S{i+1}T{t+1}", f"gross={sdata['gross_total']:,} margin={sdata['margin_amount']:,}")
        else:
            fail(f"Settlement S{i+1}T{t+1}", f"status={r.status_code} body={r.text[:200]}")

    scenario_results.append({
        "origin": origin_key,
        "working": working_key,
        "hostess": h,
        "expected_total": sc["expected_total"],
        "pre_settlement": sc["pre_settlement"],
        "sessions": sessions_data,
    })


# =================================================================
# Phase 6: Cross-store settlement verification (DB direct, this run only)
# =================================================================
log("\n=== Phase 6: Cross-store settlement verification ===")

# 이번 실행에서 생성한 세션만 기준으로 DB 직접 합산
origin_totals = {}  # origin_key -> { actual, expected }

for sc_result in scenario_results:
    origin_key = sc_result["origin"]
    origin_label = STORES[origin_key]["label"]
    expected = sc_result["expected_total"]

    # 이번 실행 세션들의 hostess_payout_amount 합산
    actual = 0
    for sess in sc_result["sessions"]:
        parts = sb_query("session_participants", {
            "session_id": f"eq.{sess['session_id']}",
            "membership_id": f"eq.{sc_result['hostess']['membership_id']}",
            "select": "hostess_payout_amount",
        })
        for p in parts:
            actual += p.get("hostess_payout_amount", 0)

    if origin_key not in origin_totals:
        origin_totals[origin_key] = {"actual": 0, "expected": 0}
    origin_totals[origin_key]["actual"] += actual
    origin_totals[origin_key]["expected"] += expected

    ok(f"CrossStore DB {origin_label}", f"actual={actual:,} expected={expected:,}")

# 6a. CrossStore API 호출 확인 (응답이 0이 아닌지)
for sc_result in scenario_results:
    origin_key = sc_result["origin"]
    origin_token = tokens[origin_key]
    origin_label = STORES[origin_key]["label"]
    r = api("GET", "/api/cross-store/settlement", origin_token)
    if r.status_code == 200:
        api_total = r.json()["summary"]["total_payout"]
        api_count = r.json()["summary"]["count"]
        if api_total > 0:
            ok(f"CrossStore API {origin_label}", f"total_payout={api_total:,} count={api_count}")
        else:
            fail(f"CrossStore API {origin_label}", f"total_payout=0 (expected > 0)")
    else:
        fail(f"CrossStore API {origin_label}", f"status={r.status_code}")

# 6b. Exact amount verification (DB direct)
log("\n=== Phase 7: Exact amount verification ===")

for origin_key, totals in origin_totals.items():
    label = STORES[origin_key]["label"]
    assert_exact(f"{label} cross-store payout", totals["expected"], totals["actual"])

# 6c. Net settlement
log("\n--- Net settlement ---")
marvel_actual = origin_totals.get("marvel", {}).get("actual", 0)
live_actual = origin_totals.get("live", {}).get("actual", 0)
burning_actual = origin_totals.get("burning", {}).get("actual", 0)
net_marvel_live = marvel_actual - live_actual

assert_exact("Marvel payout", 390000, marvel_actual)
assert_exact("Live payout", 130000, live_actual)
assert_exact("Net (Marvel - Live)", 260000, net_marvel_live)
assert_exact("Burning payout", 280000, burning_actual)

log(f"\n  Marvel<>Live: {marvel_actual:,} - {live_actual:,} = {net_marvel_live:,} (Marvel receives)")
log(f"  Burning<-Hwangjini: {burning_actual:,}")

# 6e. Pre-settlement deduction verification
log("\n--- Pre-settlement deduction check ---")
for sc_result in scenario_results:
    if sc_result["pre_settlement"] > 0:
        origin_label = STORES[sc_result["origin"]]["label"]
        working_label = STORES[sc_result["working"]]["label"]
        # 첫 번째 세션에 선정산이 차감되었는지 확인
        first_session = sc_result["sessions"][0] if sc_result["sessions"] else None
        if first_session:
            assert_exact(
                f"PreSettlement deduction ({origin_label}->{working_label})",
                sc_result["pre_settlement"],
                first_session["pre_settlement_total"],
            )


# =================================================================
# Phase 8: DB-level verification (Supabase direct)
# =================================================================
log("\n=== Phase 8: DB-level verification ===")

for sc_result in scenario_results:
    origin_key = sc_result["origin"]
    origin_uuid = STORES[origin_key]["uuid"]
    h_mid = sc_result["hostess"]["membership_id"]
    origin_label = STORES[origin_key]["label"]

    # session_participants에 origin_store_uuid가 정확히 기록되었는지
    for sess in sc_result["sessions"]:
        parts = sb_query("session_participants", {
            "session_id": f"eq.{sess['session_id']}",
            "membership_id": f"eq.{h_mid}",
            "select": "origin_store_uuid,price_amount,hostess_payout_amount",
        })
        if parts:
            p = parts[0]
            assert_exact(
                f"DB origin_store ({origin_label} session={sess['session_id'][:8]})",
                origin_uuid,
                p.get("origin_store_uuid"),
            )
        else:
            fail(f"DB participant not found ({origin_label} session={sess['session_id'][:8]})")

    # receipts snapshot에 cross_store 정보가 포함되었는지
    for sess in sc_result["sessions"]:
        receipts = sb_query("receipts", {
            "session_id": f"eq.{sess['session_id']}",
            "select": "snapshot",
            "order": "version.desc",
            "limit": "1",
        })
        if receipts:
            snapshot = receipts[0].get("snapshot", {})
            cs = snapshot.get("cross_store", {})
            cs_amount = cs.get("hostess_amount_cross_store", 0)
            if cs_amount > 0:
                ok(f"DB snapshot cross_store ({origin_label} session={sess['session_id'][:8]})", f"cross_store_amount={cs_amount:,}")
            else:
                fail(f"DB snapshot cross_store ({origin_label} session={sess['session_id'][:8]})", "cross_store amount=0")
        else:
            fail(f"DB receipt not found (session={sess['session_id'][:8]})")


# =================================================================
# Summary
# =================================================================
report()
sys.exit(0 if failed == 0 else 1)
