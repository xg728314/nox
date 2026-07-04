"""
Realistic load-test seed.
  - 운영 매장 24개 (TEST/카페 제외) × 30명 신규 식구 = 720명
  - 이름 풀 50개 (숫자 없음) — 동명이인 자연 발생
  - 각 식구 6~10세션 시뮬레이션 (퍼블릭/하퍼/셔츠 랜덤)
  - 30% cross-store, 70% 본 매장
  - 채팅 메시지 cross-store dispatch 패턴 — pattern parser 테스트용
"""
import json, urllib.request, sys, io, random, uuid, time
from datetime import datetime, timedelta, timezone
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBpYm9lY2F3a2VxYWh5cWJjaXplIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTc0OTQyMiwiZXhwIjoyMDkxMzI1NDIyfQ._cxZQy95QvaLz8rOmEnn3wUiUyKnTNSzYzdOX1JL4b4"
BASE = "https://piboecawkeqahyqbcize.supabase.co/rest/v1"
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json", "Prefer": "return=representation"}

# ─── 50-name pool — 숫자 없는 한국 이름 ────────────────────────────
NAMES = [
    "지연", "미연", "수연", "유리", "채린", "하늘", "소희", "다은", "지효", "채은",
    "서연", "나래", "별", "채아", "예린", "미나", "지유", "보영", "다인", "가은",
    "윤서", "다현", "지원", "수민", "하영", "보라", "은비", "완메", "보미", "다미",
    "라미", "가람", "미라", "소미", "지희", "유나", "미정", "보경", "다영", "채영",
    "효주", "다해", "미소", "가영", "라온", "시아", "도아", "채율", "은서", "예나",
]

random.seed(42)

# ─── helpers ─────────────────────────────────────────────────────
def req(method, path, body=None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, headers=H, method=method)
    try:
        with urllib.request.urlopen(r) as resp:
            txt = resp.read().decode()
            return json.loads(txt) if txt else None
    except urllib.error.HTTPError as e:
        body_txt = e.read().decode()
        print(f"  ✗ {method} {path[:80]}... → {e.code}: {body_txt[:200]}", flush=True)
        raise

def get(path):  return req("GET", path)
def post(path, body): return req("POST", path, body)
def patch(path, body): return req("PATCH", path, body)

# ─── Phase 1: 매장 + 매니저 inventory ─────────────────────────────
print("\n=== Phase 1: 매장 + 매니저 조회 ===")
stores = get("/stores?select=id,store_name,floor&deleted_at=is.null&order=floor")
ops_stores = [s for s in stores if "TEST" not in s["store_name"] and "카페" not in s["store_name"] and "Café" not in s["store_name"]]
print(f"운영 매장: {len(ops_stores)}개")

# 각 매장의 매니저 1명 (기본 담당 배정용)
store_managers = {}  # store_uuid -> [manager_membership_id, ...]
for s in ops_stores:
    mgrs = get(f"/store_memberships?select=id,profile_id&store_uuid=eq.{s['id']}&role=eq.manager&status=eq.approved")
    store_managers[s["id"]] = [m["id"] for m in mgrs]
    if not mgrs:
        print(f"  ⚠ {s['store_name']} ({s['id'][:8]}) 매니저 없음")

# ─── Phase 2: 30명 신규 식구 추가 per 매장 ─────────────────────────
print("\n=== Phase 2: 각 매장 30명 신규 식구 ===")
created_hostesses = []  # {membership_id, store_uuid, store_name, name, manager_id}

for s in ops_stores:
    sname = s["store_name"]
    store_uuid = s["id"]
    mgrs = store_managers.get(store_uuid, [])
    if not mgrs:
        print(f"  ⚠ {sname}: 매니저 없어 skip")
        continue
    # 30명 랜덤 (이름 풀에서 sampling — 중복 허용 → 동명이인 자연 발생)
    picks = random.choices(NAMES, k=30)
    mids_created = []
    for nm in picks:
        # 1. profile + auth.user 만들 수 없으므로 store_memberships 만 (profile_id null)
        mid_row = post("/store_memberships", {
            "store_uuid": store_uuid,
            "role": "hostess",
            "status": "approved",
            "is_primary": True,
        })
        mid = mid_row[0]["id"]
        # 2. hostess row
        hid_row = post("/hostesses", {
            "store_uuid": store_uuid,
            "membership_id": mid,
            "name": nm,
            "manager_membership_id": random.choice(mgrs),
            "origin_store_uuid": store_uuid,
        })
        mids_created.append({"membership_id": mid, "store_uuid": store_uuid, "store_name": sname,
                             "name": nm, "manager_id": hid_row[0]["manager_membership_id"]})
    created_hostesses.extend(mids_created)
    print(f"  ✓ {sname[:12]:12s} +30명 (uuid: {store_uuid[:8]})")

print(f"\n총 신규 식구: {len(created_hostesses)}명")

# ─── Phase 3: business_day 확보 + service_types 캐시 ─────────────
print("\n=== Phase 3: 영업일 + 종목 단가 캐시 ===")
today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
biz_days = {}  # store_uuid -> business_day_id
for s in ops_stores:
    rows = get(f"/store_operating_days?select=id,business_date,status&store_uuid=eq.{s['id']}&order=business_date.desc&limit=1")
    if rows and rows[0]["status"] == "open":
        biz_days[s["id"]] = rows[0]["id"]
    else:
        # 새로 생성
        try:
            new = post("/store_operating_days", {
                "store_uuid": s["id"],
                "business_date": today,
                "status": "open",
            })
            biz_days[s["id"]] = new[0]["id"]
        except Exception as e:
            print(f"  ⚠ {s['store_name']}: business_day 생성 실패 — {e}")

# service_types 캐시
service_cache = {}  # store_uuid -> { "퍼블릭|기본": {price, time_minutes, manager_deduction}, ... }
for s in ops_stores:
    sts = get(f"/store_service_types?select=service_type,time_type,price,time_minutes,manager_deduction&store_uuid=eq.{s['id']}")
    cache = {}
    for t in sts:
        cache[f"{t['service_type']}|{t['time_type']}"] = t
    service_cache[s["id"]] = cache

# rooms 캐시 (per 매장)
rooms_cache = {}
for s in ops_stores:
    rms = get(f"/rooms?select=id,name&store_uuid=eq.{s['id']}&deleted_at=is.null&limit=20")
    rooms_cache[s["id"]] = [r["id"] for r in rms]

# ─── Phase 4: 세션 시뮬레이션 ─────────────────────────────────────
print("\n=== Phase 4: 식구별 6~10 세션 시뮬레이션 ===")
CATS = ["퍼블릭", "셔츠", "하퍼"]
TIMES = ["기본", "반티", "차3"]
total_parts = 0
cross_count = 0

# 각 매장 active session 1개씩 미리 만들기 (룸 사용)
existing_sessions = {}  # (store_uuid) -> [session_id, ...]
for s in ops_stores:
    sid_list = []
    bid = biz_days.get(s["id"])
    rooms = rooms_cache.get(s["id"], [])
    if not bid or not rooms: continue
    # 룸당 1 세션 만들기
    for ri, rid in enumerate(rooms[:4]):  # 매장당 4룸 사용
        try:
            sess = post("/room_sessions", {
                "store_uuid": s["id"],
                "room_uuid": rid,
                "business_day_id": bid,
                "status": "active",
                "started_at": (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat(),
            })
            sid_list.append(sess[0]["id"])
        except Exception:
            pass
    existing_sessions[s["id"]] = sid_list

# 각 식구마다 6~10 세션 등록
for hi, h in enumerate(created_hostesses):
    n_sessions = random.randint(6, 10)
    home_store = h["store_uuid"]
    for i in range(n_sessions):
        # 30% cross-store
        is_cross = random.random() < 0.30
        if is_cross:
            other = random.choice([s for s in ops_stores if s["id"] != home_store])
            target_store = other["id"]
        else:
            target_store = home_store
        sess_list = existing_sessions.get(target_store, [])
        if not sess_list: continue
        sid = random.choice(sess_list)
        cat = random.choice(CATS)
        tt = random.choice(TIMES)
        sc = service_cache.get(target_store, {}).get(f"{cat}|{tt}")
        if not sc: continue
        # finished 세션 (left_at)
        entered = datetime.now(timezone.utc) - timedelta(minutes=random.randint(60, 600))
        left = entered + timedelta(minutes=sc["time_minutes"])
        body = {
            "session_id": sid,
            "store_uuid": target_store,
            "membership_id": h["membership_id"],
            "role": "hostess",
            "category": cat,
            "time_minutes": sc["time_minutes"],
            "price_amount": sc["price"],
            "manager_payout_amount": sc["manager_deduction"],
            "hostess_payout_amount": sc["price"] - sc["manager_deduction"],
            "status": "left",
            "entered_at": entered.isoformat(),
            "left_at": left.isoformat(),
        }
        if is_cross:
            body["origin_store_uuid"] = home_store
            # transfer_request 자동 생성 trigger 충족 위해 transfer row 미리 INSERT
            try:
                tr = post("/transfer_requests", {
                    "store_uuid": target_store,
                    "from_store_uuid": home_store,
                    "to_store_uuid": target_store,
                    "hostess_membership_id": h["membership_id"],
                    "status": "approved",
                    "requested_by": h["manager_id"],
                    "responded_by": h["manager_id"],
                    "responded_at": entered.isoformat(),
                })
                body["transfer_request_id"] = tr[0]["id"]
            except Exception:
                continue  # transfer 실패 시 skip
        try:
            post("/session_participants", body)
            total_parts += 1
            if is_cross: cross_count += 1
        except Exception:
            pass
    if (hi + 1) % 100 == 0:
        print(f"  ...{hi+1}/{len(created_hostesses)} 식구 처리됨, 누적 {total_parts}건 (cross {cross_count})")

print(f"\n총 세션 참여: {total_parts}건 (cross-store {cross_count}건, {100*cross_count/max(1,total_parts):.0f}%)")

# ─── Phase 5: 검증 ─────────────────────────────────────────────
print("\n=== Phase 5: 검증 ===")
total_h = get("/hostesses?select=count")
print(f"DB 전체 식구 수: {total_h[0]['count'] if total_h else '?'}")
parts_today = get(f"/session_participants?select=count&deleted_at=is.null")
print(f"DB 전체 세션 참여 수: {parts_today[0]['count'] if parts_today else '?'}")

# 동명이인 매장간 검증
print("\n=== 동명이인 매장간 식구 ===")
for nm in ["지연", "별", "지유", "채린", "유리"][:5]:
    rows = get(f"/hostesses?select=store_uuid,name&name=eq.{nm}&deleted_at=is.null")
    by_store = {}
    for r in rows:
        by_store.setdefault(r["store_uuid"], 0)
        by_store[r["store_uuid"]] += 1
    print(f"  '{nm}': {len(rows)}명 / {len(by_store)}개 매장")

print("\n=== 완료 ===")
