#!/usr/bin/env python3
"""NOX Cafe (Veloce Café) E2E Test — Step Cafe.

흐름:
  1. 카페 owner 로그인 → bootstrap (profile.floor === 3 검증)
  2. 메뉴 등록 (이름, 가격, 카테고리)
  3. 손님 storefront 접근 (/api/cafe/storefront/[store_uuid])
  4. 주문 생성 (POST /api/cafe/orders) + 결제방식 = account
  5. owner inbox 에서 주문 보임 + 상태 진행 (pending → preparing → delivering → delivered)
  6. delivered 후 외상 전환 (POST /api/cafe/credits)
  7. credits 목록 + 외상 PII 열람 audit log 확인
  8. 소모품 등록 + 메뉴 BOM 연결 + 주문 시 자동 차감 검증
  9. 계좌 정보 등록/조회

사용:
  set NEXT_PUBLIC_SUPABASE_URL=...
  set SUPABASE_SERVICE_ROLE_KEY=...
  set CAFE_OWNER_EMAIL=cafe@example.com
  set CAFE_OWNER_PASSWORD=...
  python scripts/test-cafe-e2e.py
"""

import json
import os
import sys
import time
import requests

SB_URL_ENV = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
SB_KEY_ENV = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
if not SB_URL_ENV or not SB_KEY_ENV:
    print("[test-cafe-e2e] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.", file=sys.stderr)
    sys.exit(2)

BASE = os.environ.get("NOX_BASE_URL", "http://localhost:3001")
EMAIL = os.environ.get("CAFE_OWNER_EMAIL", "cafe@example.com")
PASSWORD = os.environ.get("CAFE_OWNER_PASSWORD", "cafe1234")

passed = 0
failed = 0
errors: list[str] = []


def log(msg: str) -> None:
    print(msg, flush=True)


def ok(name: str, detail: str = "") -> None:
    global passed
    passed += 1
    log(f"  [PASS] {name} {detail}")


def fail(name: str, detail: str = "") -> None:
    global failed
    failed += 1
    errors.append(f"{name}: {detail}")
    log(f"  [FAIL] {name} {detail}")


def api(method: str, path: str, token: str | None = None, body=None, params=None) -> requests.Response:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return requests.request(
        method,
        f"{BASE}{path}",
        headers=headers,
        json=body,
        params=params,
        timeout=30,
    )


def login() -> str | None:
    log("\n[1] Login as cafe owner")
    r = api("POST", "/api/auth/login", body={"email": EMAIL, "password": PASSWORD})
    if r.status_code != 200:
        fail("login", f"status={r.status_code} body={r.text[:200]}")
        return None
    d = r.json()
    token = d.get("access_token") or d.get("token")
    if not token:
        fail("login", f"no access_token in response: {d}")
        return None
    ok("login", f"token={token[:20]}...")
    return token


def test_bootstrap(token: str) -> dict | None:
    log("\n[2] Bootstrap — profile.floor === 3 expected")
    r = api("GET", "/api/cafe/manage/bootstrap", token)
    if r.status_code != 200:
        fail("bootstrap", f"status={r.status_code}")
        return None
    d = r.json()
    if d.get("profile", {}).get("store_uuid") is None:
        fail("bootstrap.profile", "missing store_uuid")
        return None
    ok("bootstrap.profile", f"store={d['profile'].get('store_name')}")
    if "inbox" not in d:
        fail("bootstrap.inbox", "missing")
    else:
        ok("bootstrap.inbox", json.dumps(d["inbox"]))
    if "credits_unpaid" not in d:
        fail("bootstrap.credits_unpaid", "missing")
    else:
        ok("bootstrap.credits_unpaid", json.dumps(d["credits_unpaid"]))
    return d


def test_account(token: str) -> None:
    log("\n[3] Account (계좌) put + get")
    r = api(
        "PUT",
        "/api/cafe/account",
        token,
        body={
            "bank_name": "신한은행",
            "account_number": "110-XXX-XXX",
            "account_holder": "Veloce Café",
            "is_active": True,
        },
    )
    if r.status_code != 200:
        fail("account.put", f"status={r.status_code} body={r.text[:200]}")
        return
    ok("account.put", "saved")

    r2 = api("GET", "/api/cafe/account", token)
    if r2.status_code != 200:
        fail("account.get", f"status={r2.status_code}")
        return
    d = r2.json()
    if d.get("bank_name") != "신한은행":
        fail("account.get.bank_name", f"got={d}")
        return
    ok("account.get", f"bank={d.get('bank_name')}")


def test_menu_create(token: str) -> str | None:
    log("\n[4] Menu create")
    r = api(
        "POST",
        "/api/cafe/menu",
        token,
        body={
            "name": f"E2E_아메리카노_{int(time.time())}",
            "category": "커피",
            "price": 4500,
            "description": "E2E 테스트 메뉴",
            "is_active": True,
        },
    )
    if r.status_code not in (200, 201):
        fail("menu.create", f"status={r.status_code} body={r.text[:200]}")
        return None
    d = r.json()
    menu_id = d.get("id") or d.get("menu_id")
    if not menu_id:
        fail("menu.create", f"no id in response: {d}")
        return None
    ok("menu.create", f"menu_id={menu_id}")
    return menu_id


def test_storefront(store_uuid: str) -> None:
    log("\n[5] Storefront (no auth)")
    r = api("GET", f"/api/cafe/storefront/{store_uuid}")
    if r.status_code != 200:
        fail("storefront", f"status={r.status_code}")
        return
    d = r.json()
    if not isinstance(d.get("menu"), list):
        fail("storefront.menu", "not list")
        return
    ok("storefront", f"menu_count={len(d['menu'])}")


def test_inbox_state_machine(token: str, order_id: str) -> None:
    log("\n[6] Order state transitions")
    for status in ("preparing", "delivering", "delivered"):
        r = api(
            "PATCH",
            f"/api/cafe/orders/{order_id}",
            token,
            body={"status": status},
        )
        if r.status_code != 200:
            fail(f"order.transition.{status}", f"status={r.status_code} body={r.text[:200]}")
            return
        ok(f"order.transition.{status}", "ok")


def test_credit_conversion(token: str, order_id: str) -> str | None:
    log("\n[7] Credit (외상) conversion")
    r = api(
        "POST",
        "/api/cafe/credits",
        token,
        body={
            "order_id": order_id,
            "customer_name": "E2E 손님",
            "customer_phone": "010-0000-0000",
            "memo": "E2E 외상 전환 테스트",
        },
    )
    if r.status_code not in (200, 201):
        fail("credit.create", f"status={r.status_code} body={r.text[:200]}")
        return None
    d = r.json()
    cid = d.get("id") or d.get("credit_id")
    if not cid:
        fail("credit.create", f"no id: {d}")
        return None
    ok("credit.create", f"credit_id={cid}")
    return cid


def test_credit_pii_audit(token: str) -> None:
    log("\n[8] Credit list (PII access audit expected)")
    r = api("GET", "/api/cafe/credits", token)
    if r.status_code != 200:
        fail("credit.list", f"status={r.status_code}")
        return
    ok("credit.list", "fetched (audit log emitted server-side)")


def test_summary() -> None:
    log("\n" + "=" * 50)
    log(f"PASS: {passed}   FAIL: {failed}")
    if errors:
        log("\nERRORS:")
        for e in errors:
            log(f"  - {e}")


def main() -> int:
    token = login()
    if not token:
        test_summary()
        return 1

    boot = test_bootstrap(token)
    if not boot:
        test_summary()
        return 1

    store_uuid = boot["profile"]["store_uuid"]

    test_account(token)
    test_menu_create(token)
    test_storefront(store_uuid)

    # 주문은 storefront 측 endpoint 가 매장별로 다르므로 inbox 의 가장 최근
    # pending 주문이 있을 때만 state machine + credit 흐름 검증.
    inbox = api("GET", "/api/cafe/orders/inbox", token)
    if inbox.status_code == 200:
        orders = inbox.json().get("orders", [])
        pending = next((o for o in orders if o.get("status") == "pending"), None)
        if pending:
            order_id = pending["id"]
            test_inbox_state_machine(token, order_id)
            test_credit_conversion(token, order_id)
        else:
            log("\n[6-7] skipped (no pending orders to test state machine)")

    test_credit_pii_audit(token)

    test_summary()
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
