"""
Realistic load-test seed — SQL exec 방식.
  - auth.users 에 dummy user 30 × 매장수 만들고
  - store_memberships + hostesses 한꺼번에 SQL 로 INSERT
  - 세션 + participants 도 SQL 로 일괄
"""
import json, urllib.request, sys, io, random, uuid
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBpYm9lY2F3a2VxYWh5cWJjaXplIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTc0OTQyMiwiZXhwIjoyMDkxMzI1NDIyfQ._cxZQy95QvaLz8rOmEnn3wUiUyKnTNSzYzdOX1JL4b4"
BASE = "https://piboecawkeqahyqbcize.supabase.co/rest/v1"
H = {"apikey":KEY,"Authorization":f"Bearer {KEY}","Content-Type":"application/json"}

def sql(q):
    body = json.dumps({"sql": q}).encode()
    r = urllib.request.Request(BASE+"/rpc/exec_sql", data=body, headers=H, method="POST")
    try:
        return urllib.request.urlopen(r).read().decode()
    except urllib.error.HTTPError as e:
        body_txt = e.read().decode()
        print(f"  ✗ SQL fail: {e.code} {body_txt[:300]}", flush=True)
        raise

def get(p):
    r = urllib.request.Request(BASE+p, headers=H)
    return json.loads(urllib.request.urlopen(r).read())

NAMES = [
    "지연", "미연", "수연", "유리", "채린", "하늘", "소희", "다은", "지효", "채은",
    "서연", "나래", "별", "채아", "예린", "미나", "지유", "보영", "다인", "가은",
    "윤서", "다현", "지원", "수민", "하영", "보라", "은비", "완메", "보미", "다미",
    "라미", "가람", "미라", "소미", "지희", "유나", "미정", "보경", "다영", "채영",
    "효주", "다해", "미소", "가영", "라온", "시아", "도아", "채율", "은서", "예나",
]

random.seed(42)

print("=== Phase 1: 매장 + 매니저 ===")
stores = get("/stores?select=id,store_name,floor&deleted_at=is.null&order=floor")
ops_stores = [s for s in stores if "TEST" not in s["store_name"] and "카페" not in s["store_name"] and "Café" not in s["store_name"]]
print(f"운영 매장: {len(ops_stores)}개")

store_mgr = {}
for s in ops_stores:
    mgrs = get(f"/store_memberships?select=id&store_uuid=eq.{s['id']}&role=eq.manager&status=eq.approved&limit=1")
    if mgrs: store_mgr[s["id"]] = mgrs[0]["id"]

# ─── Phase 2: 매장당 30명 식구 — SQL 일괄 INSERT ─────────────────
print("\n=== Phase 2: 매장당 30명 신규 식구 ===")

# auth.users 에 dummy 만들기 + store_memberships + hostesses 한번에
all_inserts = []  # (membership_id, store_uuid, store_name, name, manager_id)

import re
def esc(s): return s.replace("'", "''")

for s in ops_stores:
    sname = s["store_name"]
    store_uuid = s["id"]
    mgr_id = store_mgr.get(store_uuid)
    if not mgr_id:
        print(f"  ⚠ {sname}: 매니저 없어 skip")
        continue

    picks = [random.choice(NAMES) for _ in range(30)]
    # 30 명 한꺼번에 SQL CTE
    parts = []
    for nm in picks:
        uid = str(uuid.uuid4())
        mid = str(uuid.uuid4())
        hid = str(uuid.uuid4())
        parts.append((uid, mid, hid, esc(nm)))
        all_inserts.append({"membership_id": mid, "store_uuid": store_uuid, "store_name": sname, "name": nm, "manager_id": mgr_id})

    # 1) auth.users 30 INSERT
    users_sql = "INSERT INTO auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role) VALUES "
    rows = []
    for (uid, mid, hid, nm) in parts:
        rows.append(f"('{uid}', '00000000-0000-0000-0000-000000000000', 'seed_{uid[:8]}@test.local', '', now(), now(), now(), 'authenticated', 'authenticated')")
    users_sql += ", ".join(rows) + " ON CONFLICT (id) DO NOTHING;"

    # 2) store_memberships
    mem_sql = "INSERT INTO store_memberships (id, user_id, store_uuid, role, status, is_primary, created_at, updated_at) VALUES "
    rows = []
    for (uid, mid, hid, nm) in parts:
        rows.append(f"('{mid}', '{uid}', '{store_uuid}', 'hostess', 'approved', true, now(), now())")
    mem_sql += ", ".join(rows) + ";"

    # 3) hostesses
    hst_sql = "INSERT INTO hostesses (id, store_uuid, membership_id, name, manager_membership_id, origin_store_uuid, created_at, updated_at) VALUES "
    rows = []
    for (uid, mid, hid, nm) in parts:
        rows.append(f"('{hid}', '{store_uuid}', '{mid}', '{nm}', '{mgr_id}', '{store_uuid}', now(), now())")
    hst_sql += ", ".join(rows) + ";"

    try:
        sql(users_sql)
        sql(mem_sql)
        sql(hst_sql)
        print(f"  ✓ {sname[:12]:12s} +30명 ({store_uuid[:8]})")
    except Exception as e:
        print(f"  ✗ {sname[:12]}: {e}")
        # 진행 계속

print(f"\n총 신규 식구: {len(all_inserts)}명")

# ─── Phase 3: 영업일 + service_types + rooms 캐시 ─────────────────
print("\n=== Phase 3: 영업일 / 종목 / 룸 캐시 ===")
biz_days = {}
for s in ops_stores:
    rows = get(f"/store_operating_days?select=id,status&store_uuid=eq.{s['id']}&order=business_date.desc&limit=1")
    if rows and rows[0]["status"] == "open":
        biz_days[s["id"]] = rows[0]["id"]

service_cache = {}
for s in ops_stores:
    sts = get(f"/store_service_types?select=service_type,time_type,price,time_minutes,manager_deduction&store_uuid=eq.{s['id']}")
    cache = {}
    for t in sts:
        cache[f"{t['service_type']}|{t['time_type']}"] = t
    service_cache[s["id"]] = cache

rooms_cache = {}
for s in ops_stores:
    rms = get(f"/rooms?select=id&store_uuid=eq.{s['id']}&deleted_at=is.null&limit=20")
    rooms_cache[s["id"]] = [r["id"] for r in rms]

# ─── Phase 4: 세션 + participants ────────────────────────────────
print("\n=== Phase 4: 세션 시뮬레이션 ===")
CATS = ["퍼블릭", "셔츠", "하퍼"]
TIMES = ["기본", "반티", "차3"]

# 매장당 active 세션 미리 만들기 — SQL bulk INSERT
print("  active 세션 생성 중...")
session_by_store = {}
for s in ops_stores:
    bid = biz_days.get(s["id"])
    rooms = rooms_cache.get(s["id"], [])[:4]
    if not bid or not rooms: continue
    parts = []
    sids = []
    for rid in rooms:
        sid = str(uuid.uuid4())
        sids.append(sid)
        parts.append(f"('{sid}', '{s['id']}', '{rid}', '{bid}', 'active', NOW() - INTERVAL '60 minutes', NOW(), NOW())")
    if parts:
        try:
            sql(f"INSERT INTO room_sessions (id, store_uuid, room_uuid, business_day_id, status, started_at, created_at, updated_at) VALUES {','.join(parts)};")
            session_by_store[s["id"]] = sids
        except Exception as e:
            pass

# 각 식구마다 6~10 participants — SQL bulk per 1000 row
print("  participants 일괄 INSERT 중...")
all_parts = []
all_transfers = []
total_cross = 0
total_parts = 0

for h in all_inserts:
    n = random.randint(6, 10)
    home = h["store_uuid"]
    for _ in range(n):
        is_cross = random.random() < 0.30
        if is_cross:
            others = [s for s in ops_stores if s["id"] != home]
            target = random.choice(others)["id"]
        else:
            target = home
        sids = session_by_store.get(target, [])
        if not sids: continue
        sid = random.choice(sids)
        cat = random.choice(CATS)
        tt = random.choice(TIMES)
        sc = service_cache.get(target, {}).get(f"{cat}|{tt}")
        if not sc: continue
        pid = str(uuid.uuid4())
        entered_min = random.randint(60, 600)
        time_min = sc["time_minutes"]
        price = sc["price"]
        mdeduct = sc["manager_deduction"]
        hpay = price - mdeduct

        if is_cross:
            tr_id = str(uuid.uuid4())
            all_transfers.append(
                f"('{tr_id}', '{target}', '{home}', '{target}', '{h['membership_id']}', 'approved', "
                f"'{h['manager_id']}', '{h['manager_id']}', NOW() - INTERVAL '{entered_min} minutes', NOW(), NOW())"
            )
            origin_clause = f"'{home}'"
            tr_clause = f"'{tr_id}'"
            total_cross += 1
        else:
            origin_clause = "NULL"
            tr_clause = "NULL"

        all_parts.append(
            f"('{pid}', '{sid}', '{target}', {origin_clause}, '{h['membership_id']}', 'hostess', "
            f"'{cat}', '{tt}', {time_min}, {price}, {mdeduct}, {hpay}, 'left', "
            f"NOW() - INTERVAL '{entered_min} minutes', "
            f"NOW() - INTERVAL '{max(0, entered_min - time_min)} minutes', "
            f"{tr_clause}, NOW(), NOW())"
        )
        total_parts += 1

# transfer_requests 먼저
print(f"  transfer_requests {len(all_transfers)}건 INSERT...")
CHUNK = 200
for i in range(0, len(all_transfers), CHUNK):
    chunk = all_transfers[i:i+CHUNK]
    try:
        sql(f"INSERT INTO transfer_requests (id, store_uuid, from_store_uuid, to_store_uuid, hostess_membership_id, status, requested_by, responded_by, responded_at, created_at, updated_at) VALUES {','.join(chunk)};")
    except Exception as e:
        print(f"    transfer chunk {i//CHUNK} fail: {e}")

print(f"  session_participants {len(all_parts)}건 INSERT...")
for i in range(0, len(all_parts), CHUNK):
    chunk = all_parts[i:i+CHUNK]
    try:
        sql(f"INSERT INTO session_participants (id, session_id, store_uuid, origin_store_uuid, membership_id, role, category, time_type, time_minutes, price_amount, manager_payout_amount, hostess_payout_amount, status, entered_at, left_at, transfer_request_id, created_at, updated_at) VALUES {','.join(chunk)};")
    except Exception as e:
        print(f"    parts chunk {i//CHUNK} fail: {e}")

print(f"\n총 참여: {total_parts}건 (cross-store {total_cross}건 = {100*total_cross/max(1,total_parts):.0f}%)")

# ─── Phase 5: 검증 ───────────────────────────────────────────────
print("\n=== Phase 5: 검증 ===")
total_h = get("/hostesses?select=id&limit=1")
print(f"DB 전체 식구 확인됨")
# 동명이인 매장간
for nm in ["지연", "별", "채린", "유리", "미라"]:
    rows = get(f"/hostesses?select=store_uuid&name=eq.{nm}&deleted_at=is.null")
    stores_set = set(r["store_uuid"] for r in rows)
    print(f"  '{nm}': {len(rows)}명 / {len(stores_set)}개 매장")

print("\n=== 완료 ===")
