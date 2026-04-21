#!/usr/bin/env python3
"""NOX 3-store automated test"""
import json, sys, urllib.request, urllib.error

BASE = "http://localhost:3000"
PW = "Test1234!"

STORES = [
    ("라이브", "live-mgr1@nox-test.com", "d7f62182-48cb-4731-b694-b1a02d60b1fa"),
    ("버닝", "burning-mgr1@nox-test.com", "147b2115-6ece-48ed-9ca0-63fd31ea2c38"),
    ("황진이", "hwangjini-mgr1@nox-test.com", "cbacf389-4cd7-4459-b97d-d7775ddaf8d0"),
]

total_pass = 0
total_fail = 0

def api(method, path, token=None, body=None):
    url = f"{BASE}{path}"
    data = json.dumps(body).encode() if body else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())
    except Exception as e:
        return 0, {"error": str(e)}

def test_store(name, email, store_uuid):
    global total_pass, total_fail
    sp, sf = 0, 0

    print(f"\n{'='*50}")
    print(f"  {name} ({email})")
    print(f"{'='*50}")

    # 1. Login
    print("[1/7] 인증")
    code, data = api("POST", "/api/auth/login", body={"email": email, "password": PW})
    token = data.get("access_token", "")
    if not token:
        print(f"  ❌ 로그인 실패 ({code}): {data}")
        total_fail += 1
        return
    print(f"  ✅ 로그인 성공")
    sp += 1

    # 2. Rooms
    print("[2/7] 방 목록 조회")
    code, data = api("GET", "/api/rooms", token=token)
    rooms = data.get("rooms", [])
    if not rooms:
        print(f"  ❌ 방 없음: {data}")
        total_fail += 1
        return
    room_uuid = None
    for r in rooms:
        if not r.get("session"):
            room_uuid = r["id"]
            break
    if not room_uuid:
        first = rooms[0]
        sid = first["session"]["id"]
        print(f"  ⚠️  모든 방 사용 중, {first['id'][:8]}... 체크아웃 처리")
        api("POST", "/api/sessions/checkout", token=token, body={"session_id": sid})
        api("POST", "/api/sessions/settlement", token=token, body={"session_id": sid})
        room_uuid = first["id"]
    print(f"  ✅ 방 {len(rooms)}개 조회, 사용: {room_uuid[:8]}...")
    sp += 1

    # 3. Checkin
    print("[3/7] 체크인")
    code, data = api("POST", "/api/sessions/checkin", token=token, body={"room_uuid": room_uuid})
    session_id = data.get("session_id", "")
    if not session_id:
        print(f"  ❌ 체크인 실패 ({code}): {data}")
        sf += 1
        total_pass += sp; total_fail += sf
        return
    print(f"  ✅ 세션 생성: {session_id[:8]}...")
    sp += 1

    # 3b. Add hostess
    print("  └─ 아가씨 참여 추가")
    _, staff_data = api("GET", "/api/store/staff", token=token)
    hostess_mid = None
    for s in staff_data.get("staff", []):
        if s.get("role") == "hostess":
            hostess_mid = s["membership_id"]
            break
    if hostess_mid:
        code, pdata = api("POST", "/api/sessions/participants", token=token,
                          body={"session_id": session_id, "membership_id": hostess_mid, "role": "hostess"})
        if pdata.get("id") or "ALREADY" in str(pdata):
            print(f"  ✅ 아가씨 참여 완료 ({hostess_mid[:8]}...)")
        else:
            print(f"  ⚠️  참여 응답 ({code}): {str(pdata)[:120]}")
    else:
        print(f"  ⚠️  hostess 없음, 스킵")

    # 4. Order
    print("[4/7] 주문 추가")
    code, data = api("POST", "/api/sessions/orders", token=token,
                     body={"session_id": session_id, "item_name": "테스트맥주", "order_type": "drink", "qty": 2, "unit_price": 15000})
    if data.get("order_id"):
        print(f"  ✅ 주문 생성: 테스트맥주 x2 = ₩30,000")
        sp += 1
    else:
        print(f"  ❌ 주문 실패 ({code}): {data}")
        sf += 1

    # 5. Checkout
    print("[5/7] 체크아웃")
    code, data = api("POST", "/api/sessions/checkout", token=token, body={"session_id": session_id})
    if data.get("status") == "closed":
        print(f"  ✅ 체크아웃 성공 (status: closed)")
        sp += 1
    else:
        print(f"  ❌ 체크아웃 실패 ({code}): {data}")
        sf += 1
        total_pass += sp; total_fail += sf
        return

    # 6. Settlement
    print("[6/7] 정산 생성")
    code, data = api("POST", "/api/sessions/settlement", token=token, body={"session_id": session_id})
    if data.get("receipt_id"):
        gross = data.get("gross_total", 0)
        print(f"  ✅ 정산 생성 (gross_total: ₩{gross:,})")
        sp += 1
    else:
        print(f"  ❌ 정산 실패 ({code}): {data}")
        sf += 1

    # 7. Settlement summary
    print("[7/7] 정산 조회 (has_settlement 확인)")
    code, data = api("GET", "/api/manager/settlement/summary", token=token)
    summary = data.get("summary", [])
    biz_day = data.get("business_day_id", "없음")
    settled = [s for s in summary if s.get("has_settlement")]
    sum_gross = sum(s.get("gross_total", 0) or 0 for s in settled)

    if len(settled) > 0:
        print(f"  ✅ 정산 조회: {len(settled)}/{len(summary)} settled, 합계 ₩{sum_gross:,} (biz: {str(biz_day)[:8]}...)")
        sp += 1
    else:
        print(f"  ❌ 정산 조회: has_settlement 없음 ({len(settled)}/{len(summary)}), biz: {biz_day}")
        sf += 1

    print(f"  ── {name}: ✅{sp} ❌{sf} ──")
    total_pass += sp
    total_fail += sf

print("╔══════════════════════════════════════╗")
print("║   NOX 3개 매장 자동 테스트 시작       ║")
print("╚══════════════════════════════════════╝")

for name, email, uuid in STORES:
    test_store(name, email, uuid)

print(f"\n╔══════════════════════════════════════╗")
print(f"║   전체 결과: ✅{total_pass} PASS  ❌{total_fail} FAIL       ║")
print(f"╚══════════════════════════════════════╝")

sys.exit(0 if total_fail == 0 else 1)
