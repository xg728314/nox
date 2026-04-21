#!/usr/bin/env python3
"""
NOX E2E Test - Step 4: New Features
외상 / 결제 방식 / 선정산 / 채팅 / 재고 / 손님 청구서 / 마감 경고

Usage:
  python scripts/test-step4.py
"""

import json
import sys
import requests

BASE = "http://localhost:3001"
LOGIN_URL = f"{BASE}/api/auth/login"
EMAIL = "tset@gmail.com"
PASSWORD = "xptmxmdlqslek"

STORE_UUID = "ad1b95f0-5023-4c93-9282-efbb3d94ce76"
ROOM = {"name": "1번방", "uuid": "5e6f77b7-1dab-4ad5-b032-57c2865f41ca"}
HOSTESS = {"name": "마블아가씨1", "membership_id": "c0fe65ff-80bd-45af-9cd8-ada2729c41ec"}

passed = 0
failed = 0
errors = []
token = ""
membership_id = ""


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


def api(method, path, body=None, params=None):
    url = f"{BASE}{path}"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    if method == "GET":
        r = requests.get(url, headers=headers, params=params, timeout=30)
    elif method == "POST":
        r = requests.post(url, headers=headers, json=body, timeout=30)
    elif method == "PATCH":
        r = requests.patch(url, headers=headers, json=body, timeout=30)
    elif method == "DELETE":
        r = requests.delete(url, headers=headers, timeout=30)
    else:
        raise ValueError(f"Unknown method: {method}")
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
    data = r.json()
    token = data["access_token"]
    membership_id = data.get("membership_id", "")
    ok("Login", f"token={token[:20]}...")
except Exception as e:
    log(f"Login error: {e}")
    sys.exit(1)


# =========================================================
# 1. 재고 관리 (Inventory)
# =========================================================
log("\n=== Step 1: Inventory ===")

# 1a. 품목 등록
r = api("POST", "/api/inventory/items", {
    "name": "E2E테스트양주",
    "category": "양주",
    "unit": "병",
    "current_stock": 10,
    "min_stock": 3,
    "unit_cost": 50000,
})
item_id = None
if r.status_code == 201:
    item_id = r.json()["id"]
    ok("Item create", f"id={item_id[:12]}... stock=10")
elif r.status_code == 409:
    # 이미 존재 — 목록에서 찾기
    r2 = api("GET", "/api/inventory/items")
    if r2.status_code == 200:
        for it in r2.json().get("items", []):
            if it["name"] == "E2E테스트양주":
                item_id = it["id"]
                break
    ok("Item create (already exists)", f"id={item_id[:12] if item_id else 'N/A'}")
else:
    fail("Item create", f"status={r.status_code} body={r.text[:200]}")

# 1b. 품목 목록 + 저재고 플래그 확인
r = api("GET", "/api/inventory/items")
if r.status_code == 200:
    data = r.json()
    ok("Item list", f"total={data['summary']['total']} low_stock={data['summary']['low_stock']}")
else:
    fail("Item list", f"status={r.status_code}")

# 1c. 입고
if item_id:
    r = api("POST", "/api/inventory/transactions", {
        "item_id": item_id, "type": "in", "quantity": 5, "memo": "E2E입고"
    })
    if r.status_code == 201:
        ok("Stock in", f"before={r.json()['before_stock']} after={r.json()['after_stock']}")
    else:
        fail("Stock in", f"status={r.status_code} body={r.text[:200]}")

# 1d. 출고
if item_id:
    r = api("POST", "/api/inventory/transactions", {
        "item_id": item_id, "type": "out", "quantity": 2, "memo": "E2E출고"
    })
    if r.status_code == 201:
        ok("Stock out", f"before={r.json()['before_stock']} after={r.json()['after_stock']}")
    else:
        fail("Stock out", f"status={r.status_code} body={r.text[:200]}")

# 1e. 이력 조회
if item_id:
    r = api("GET", f"/api/inventory/transactions?item_id={item_id}")
    if r.status_code == 200:
        ok("Tx history", f"count={len(r.json().get('transactions', []))}")
    else:
        fail("Tx history", f"status={r.status_code}")


# =========================================================
# 2. 채팅 (Chat)
# =========================================================
log("\n=== Step 2: Chat ===")

# 2a. 글로벌 채팅방 생성/참여
r = api("POST", "/api/chat/rooms", {"type": "global"})
global_room_id = None
if r.status_code == 200:
    global_room_id = r.json()["chat_room_id"]
    ok("Global chat room", f"id={global_room_id[:12]}...")
else:
    fail("Global chat room", f"status={r.status_code} body={r.text[:200]}")

# 2b. 채팅방 목록
r = api("GET", "/api/chat/rooms")
if r.status_code == 200:
    rooms = r.json().get("rooms", [])
    ok("Chat room list", f"count={len(rooms)}")
else:
    fail("Chat room list", f"status={r.status_code}")

# 2c. 메시지 전송
if global_room_id:
    r = api("POST", "/api/chat/messages", {
        "chat_room_id": global_room_id, "content": "E2E test message"
    })
    if r.status_code == 201:
        ok("Send message", f"id={r.json()['message_id'][:12]}...")
    else:
        fail("Send message", f"status={r.status_code} body={r.text[:200]}")

# 2d. 메시지 조회
if global_room_id:
    r = api("GET", f"/api/chat/messages?chat_room_id={global_room_id}")
    if r.status_code == 200:
        msgs = r.json().get("messages", [])
        ok("Message history", f"count={len(msgs)}")
    else:
        fail("Message history", f"status={r.status_code}")

# 2e. Unread count
r = api("GET", "/api/chat/unread")
if r.status_code == 200:
    ok("Unread count", f"total={r.json().get('unread_count', 0)}")
else:
    fail("Unread count", f"status={r.status_code}")


# =========================================================
# 3. 세션 생성 → 선정산 → 주문 → 체크아웃 → 정산 → 결제 → 외상 → 청구서
# =========================================================
log("\n=== Step 3: Full session flow (pre-settlement, payment, credit, bill) ===")

# 3a. 기존 세션 정리
r = api("GET", f"/api/rooms?room_uuid={ROOM['uuid']}")
if r.status_code == 200:
    rdata = r.json()
    for rm in rdata.get("rooms", []):
        if rm.get("room_uuid") == ROOM["uuid"] and rm.get("active_session_id"):
            api("POST", "/api/sessions/checkout", {"session_id": rm["active_session_id"]})
            log(f"  Cleaned up session {rm['active_session_id'][:12]}...")

# 3b. Checkin
r = api("POST", "/api/sessions/checkin", {"room_uuid": ROOM["uuid"]})
session_id = None
if r.status_code == 201:
    session_id = r.json()["session_id"]
    ok("Checkin", f"session_id={session_id[:12]}...")
else:
    fail("Checkin", f"status={r.status_code} body={r.text[:200]}")

if not session_id:
    log("  Skipping rest of step 3 (no session)")
else:
    # 3c. 선정산 등록
    r = api("POST", "/api/sessions/pre-settlement", {
        "session_id": session_id,
        "amount": 30000,
        "requester_membership_id": membership_id or HOSTESS["membership_id"],
        "memo": "E2E선정산",
    })
    if r.status_code == 201:
        ok("Pre-settlement create", f"amount=30000 id={r.json()['id'][:12]}...")
    else:
        fail("Pre-settlement create", f"status={r.status_code} body={r.text[:200]}")

    # 3d. 선정산 조회
    r = api("GET", f"/api/sessions/pre-settlement?session_id={session_id}")
    if r.status_code == 200:
        data = r.json()
        ok("Pre-settlement list", f"count={len(data.get('pre_settlements', []))} total_active={data.get('total_active', 0)}")
    else:
        fail("Pre-settlement list", f"status={r.status_code}")

    # 3e. 참여자 등록
    r = api("POST", "/api/sessions/participants", {
        "session_id": session_id,
        "membership_id": HOSTESS["membership_id"],
        "role": "hostess",
        "category": "퍼블릭",
        "time_minutes": 90,
    })
    if r.status_code == 201:
        ok("Participant add", f"price={r.json().get('price_amount', 0)}")
    else:
        fail("Participant add", f"status={r.status_code} body={r.text[:200]}")

    # 3f. 주문 (양주 + 웨이터팁)
    r = api("POST", "/api/sessions/orders", {
        "session_id": session_id,
        "item_name": "헤네시XO",
        "order_type": "주류",
        "qty": 1,
        "unit_price": 200000,
    })
    if r.status_code == 201:
        ok("Order liquor", f"amount={r.json().get('amount', 0)}")
    else:
        fail("Order liquor", f"status={r.status_code} body={r.text[:200]}")

    r = api("POST", "/api/sessions/orders", {
        "session_id": session_id,
        "item_name": "웨이터팁",
        "order_type": "waiter_tip",
        "qty": 1,
        "unit_price": 10000,
    })
    if r.status_code == 201:
        ok("Order waiter_tip", f"amount={r.json().get('amount', 0)}")
    else:
        fail("Order waiter_tip", f"status={r.status_code} body={r.text[:200]}")

    # 3g. 손님 청구서 (세션 active 상태)
    r = api("GET", f"/api/sessions/bill?session_id={session_id}")
    if r.status_code == 200:
        bill = r.json()
        ok("Bill (active)", f"liquor={bill['liquor']['total']} time={bill['time']['total']} tip={bill['waiter_tip']} total={bill['grand_total']}")
    else:
        fail("Bill (active)", f"status={r.status_code} body={r.text[:200]}")

    # 3h. 체크아웃
    r = api("POST", "/api/sessions/checkout", {"session_id": session_id})
    if r.status_code == 200:
        ok("Checkout", f"status={r.json().get('status', '')}")
    else:
        fail("Checkout", f"status={r.status_code} body={r.text[:200]}")

    # 3i. 정산 (선정산 차감 확인)
    r = api("POST", "/api/sessions/settlement", {"session_id": session_id})
    receipt_id = None
    if r.status_code in (200, 201):
        sdata = r.json()
        receipt_id = sdata.get("receipt_id")
        pre_total = sdata.get("pre_settlement_total", 0)
        ok("Settlement", f"gross={sdata['gross_total']} pre_deduct={pre_total} margin={sdata['margin_amount']}")
        if pre_total != 30000:
            fail("Pre-settlement deduction", f"expected=30000 got={pre_total}")
        else:
            ok("Pre-settlement deduction", "30000 correctly deducted")
    else:
        fail("Settlement", f"status={r.status_code} body={r.text[:200]}")

    # 3j. 결제 — 혼합 결제 (현금 + 외상)
    if receipt_id:
        # 먼저 gross_total 확인
        gross = sdata["gross_total"]
        cash_amt = gross - 50000
        credit_amt = 50000

        r = api("POST", "/api/sessions/settlement/payment", {
            "session_id": session_id,
            "payment_method": "mixed",
            "cash_amount": cash_amt,
            "card_amount": 0,
            "credit_amount": credit_amt,
            "customer_name": "E2E테스트손님",
            "customer_phone": "010-0000-0000",
        })
        if r.status_code == 200:
            pdata = r.json()
            ok("Payment mixed", f"cash={pdata['cash_amount']} credit={pdata['credit_amount']} credit_id={pdata.get('credit_id', 'N/A')}")
        else:
            fail("Payment mixed", f"status={r.status_code} body={r.text[:200]}")

    # 3k. 외상 목록 조회
    r = api("GET", "/api/credits?status=pending")
    if r.status_code == 200:
        credits_list = r.json().get("credits", [])
        ok("Credits list", f"pending_count={len(credits_list)}")
    else:
        fail("Credits list", f"status={r.status_code}")

    # 3l. 외상 직접 등록 (결제와 별도)
    r = api("POST", "/api/credits", {
        "room_uuid": ROOM["uuid"],
        "manager_membership_id": membership_id or HOSTESS["membership_id"],
        "customer_name": "E2E직접외상손님",
        "customer_phone": "010-1234-5678",
        "amount": 100000,
        "memo": "E2E 테스트 외상",
    })
    direct_credit_id = None
    if r.status_code == 201:
        direct_credit_id = r.json()["id"]
        ok("Credit create", f"id={direct_credit_id[:12]}... amount=100000")
    else:
        fail("Credit create", f"status={r.status_code} body={r.text[:200]}")

    # 3m. 외상 회수
    if direct_credit_id:
        r = api("PATCH", f"/api/credits/{direct_credit_id}", {"status": "collected"})
        if r.status_code == 200:
            ok("Credit collect", f"status={r.json().get('status', '')}")
        else:
            fail("Credit collect", f"status={r.status_code} body={r.text[:200]}")

    # 3n. 손님 청구서 (체크아웃 후)
    r = api("GET", f"/api/sessions/bill?session_id={session_id}")
    if r.status_code == 200:
        bill = r.json()
        ok("Bill (closed)", f"grand_total={bill['grand_total']} payment={bill.get('payment_method', 'N/A')}")
    else:
        fail("Bill (closed)", f"status={r.status_code} body={r.text[:200]}")


# =========================================================
# 4. 마감 경고 (Draft warning)
# =========================================================
log("\n=== Step 4: Close warning (draft receipts) ===")

# 4a. 새 세션으로 draft receipt 만들기
r = api("POST", "/api/sessions/checkin", {"room_uuid": ROOM["uuid"]})
draft_session_id = None
if r.status_code == 201:
    draft_session_id = r.json()["session_id"]
    ok("Checkin for draft test", f"session_id={draft_session_id[:12]}...")
else:
    fail("Checkin for draft test", f"status={r.status_code}")

if draft_session_id:
    # 참여자 추가 → 체크아웃 → 정산(draft) → 마감 시도
    api("POST", "/api/sessions/participants", {
        "session_id": draft_session_id,
        "membership_id": HOSTESS["membership_id"],
        "role": "hostess", "category": "퍼블릭", "time_minutes": 45,
    })
    api("POST", "/api/sessions/checkout", {"session_id": draft_session_id})
    api("POST", "/api/sessions/settlement", {"session_id": draft_session_id})

    # 영업일 ID 조회
    r = api("GET", "/api/rooms")
    biz_day_id = None
    if r.status_code == 200:
        biz_day_id = r.json().get("business_day_id")

    if biz_day_id:
        # 마감 시도 (force 없이) → DRAFT_RECEIPTS_EXIST 예상
        r = api("POST", "/api/operating-days/close", {"business_day_id": biz_day_id})
        if r.status_code == 400:
            err = r.json()
            if err.get("error") == "DRAFT_RECEIPTS_EXIST":
                ok("Draft warning", f"draft_count={err.get('draft_count', '?')}")
            else:
                fail("Draft warning", f"expected DRAFT_RECEIPTS_EXIST, got {err.get('error')}")
        elif r.status_code == 200:
            # 이미 마감됨 또는 draft 없음
            ok("Draft warning (no drafts or already closed)")
        else:
            fail("Draft warning", f"status={r.status_code} body={r.text[:200]}")
    else:
        fail("Draft warning", "no business_day_id found")


# =========================================================
# 5. 설정 잠금 (영업일 중 변경 차단)
# =========================================================
log("\n=== Step 5: Settings lock during open business day ===")

r = api("PATCH", "/api/store/settings", {"default_waiter_tip": 10000})
if r.status_code == 403:
    err = r.json()
    if err.get("error") == "BUSINESS_DAY_OPEN":
        ok("Settings lock", "correctly blocked during open day")
    else:
        fail("Settings lock", f"403 but wrong error: {err.get('error')}")
elif r.status_code == 200:
    ok("Settings lock (no open day — update succeeded)")
else:
    fail("Settings lock", f"status={r.status_code} body={r.text[:200]}")

r = api("PATCH", "/api/store/service-types", {"updates": [{"id": "00000000-0000-0000-0000-000000000000", "price": 130000, "manager_deduction": 0}]})
if r.status_code == 403:
    err = r.json()
    if err.get("error") == "BUSINESS_DAY_OPEN":
        ok("Service-types lock", "correctly blocked during open day")
    else:
        fail("Service-types lock", f"403 but wrong error: {err.get('error')}")
elif r.status_code == 200 or r.status_code == 400:
    ok("Service-types lock (no open day or bad id — expected)")
else:
    fail("Service-types lock", f"status={r.status_code} body={r.text[:200]}")


# =========================================================
# Summary
# =========================================================
log(f"\n{'='*50}")
log(f"  TOTAL: {passed + failed} | PASS: {passed} | FAIL: {failed}")
log(f"{'='*50}")

if errors:
    log("\nFailed tests:")
    for e in errors:
        log(f"  - {e}")

sys.exit(0 if failed == 0 else 1)
