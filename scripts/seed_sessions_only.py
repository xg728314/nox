"""
세션 + participants 시뮬레이션만 (Phase 2 완료 가정).
  - 모든 식구 6~10 세션
  - 30% cross-store
  - 실제 schema 에 맞춰 수정
"""
import json, urllib.request, sys, io, random, uuid
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBpYm9lY2F3a2VxYWh5cWJjaXplIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTc0OTQyMiwiZXhwIjoyMDkxMzI1NDIyfQ._cxZQy95QvaLz8rOmEnn3wUiUyKnTNSzYzdOX1JL4b4"
BASE = "https://piboecawkeqahyqbcize.supabase.co/rest/v1"
H = {"apikey":KEY,"Authorization":f"Bearer {KEY}","Content-Type":"application/json"}

def sql(q):
    r = urllib.request.Request(BASE+"/rpc/exec_sql", data=json.dumps({"sql": q}).encode(), headers=H, method="POST")
    try:
        return urllib.request.urlopen(r).read().decode()
    except urllib.error.HTTPError as e:
        print(f"  ✗ {e.code}: {e.read().decode()[:300]}", flush=True)
        raise

def get(p):
    p = urllib.parse.quote(p, safe="?=&,:/")
    r = urllib.request.Request(BASE+p, headers=H)
    return json.loads(urllib.request.urlopen(r).read())

import urllib.parse

random.seed(99)

print("=== 매장 + 식구 + 세션 조회 ===")
stores = get("/stores?select=id,store_name,floor&deleted_at=is.null")
ops_stores = [s for s in stores if "TEST" not in s["store_name"] and "카페" not in s["store_name"] and "Café" not in s["store_name"]]
print(f"운영 매장 {len(ops_stores)}개")

# 모든 식구 — 매장별
print("식구 조회 중...")
all_hostesses = []
for s in ops_stores:
    hs = get(f"/hostesses?select=membership_id,name,manager_membership_id,store_uuid&store_uuid=eq.{s['id']}&deleted_at=is.null")
    for h in hs:
        h["store_name"] = s["store_name"]
    all_hostesses.extend(hs)
print(f"총 식구: {len(all_hostesses)}명")

# business_day
biz = {}
for s in ops_stores:
    rows = get(f"/store_operating_days?select=id,status&store_uuid=eq.{s['id']}&order=business_date.desc&limit=1")
    if rows and rows[0]["status"] == "open":
        biz[s["id"]] = rows[0]["id"]

# service_types
svc = {}
for s in ops_stores:
    sts = get(f"/store_service_types?select=service_type,time_type,price,time_minutes,manager_deduction&store_uuid=eq.{s['id']}")
    svc[s["id"]] = {f"{t['service_type']}|{t['time_type']}": t for t in sts}

# 기존 active 세션 — 재사용 (room_uuid unique)
print("기존 active 세션 조회 중...")
ex_sessions = {}  # store_uuid -> [session_ids]
for s in ops_stores:
    bid = biz.get(s["id"])
    if not bid: continue
    rows = get(f"/room_sessions?select=id&store_uuid=eq.{s['id']}&business_day_id=eq.{bid}&status=eq.active&deleted_at=is.null&limit=10")
    ex_sessions[s["id"]] = [r["id"] for r in rows]

# 새 session 만들기 — 기존 active 가 있는 룸 제외
print("active 세션 보충 중 (룸별 unique)...")
for s in ops_stores:
    bid = biz.get(s["id"])
    if not bid: continue
    # 사용중인 room_uuid
    used_rooms_rows = get(f"/room_sessions?select=room_uuid&store_uuid=eq.{s['id']}&status=eq.active&deleted_at=is.null")
    used = set(r["room_uuid"] for r in used_rooms_rows)
    # 전체 room
    all_rooms = get(f"/rooms?select=id&store_uuid=eq.{s['id']}&deleted_at=is.null&limit=20")
    free = [r["id"] for r in all_rooms if r["id"] not in used][:4]
    if not free: continue
    parts = []
    new_sids = []
    for rid in free:
        sid = str(uuid.uuid4())
        new_sids.append(sid)
        parts.append(f"('{sid}', '{s['id']}', '{rid}', '{bid}', 'active', NOW() - INTERVAL '60 minutes', NOW(), NOW())")
    if parts:
        try:
            sql(f"INSERT INTO room_sessions (id, store_uuid, room_uuid, business_day_id, status, started_at, created_at, updated_at) VALUES {','.join(parts)};")
            ex_sessions.setdefault(s["id"], []).extend(new_sids)
        except Exception:
            pass

print(f"매장당 평균 active 세션: {sum(len(v) for v in ex_sessions.values())/max(1,len(ex_sessions)):.1f}")

# ─── 세션 + participants ─────────────────────────────────────────
print("\n=== 세션 시뮬레이션 ===")
CATS = ["퍼블릭", "셔츠", "하퍼"]
TIMES = ["기본", "반티", "차3"]

all_transfers = []
all_parts = []
cross_cnt = 0

for h in all_hostesses:
    n = random.randint(6, 10)
    home = h["store_uuid"]
    for _ in range(n):
        is_cross = random.random() < 0.30
        if is_cross:
            others = [s for s in ops_stores if s["id"] != home]
            if not others: continue
            target = random.choice(others)["id"]
        else:
            target = home
        sids = ex_sessions.get(target, [])
        if not sids: continue
        sid = random.choice(sids)
        cat = random.choice(CATS)
        tt = random.choice(TIMES)
        sc = svc.get(target, {}).get(f"{cat}|{tt}")
        if not sc: continue
        pid = str(uuid.uuid4())
        entered_min = random.randint(60, 600)
        tm, price, mdeduct = sc["time_minutes"], sc["price"], sc["manager_deduction"]
        hpay = price - mdeduct

        if is_cross:
            tr_id = str(uuid.uuid4())
            target_bid = biz.get(target, "NULL")
            all_transfers.append(
                f"('{tr_id}', '{h['membership_id']}', '{home}', '{target}', '{target_bid}', 'approved', "
                f"'{h['manager_id'] if (h.get('manager_id') and False) else h.get('manager_membership_id','NULL')}', "
                f"NOW() - INTERVAL '{entered_min} minutes', "
                f"'{h.get('manager_membership_id','NULL')}', NOW() - INTERVAL '{entered_min} minutes', NOW(), NOW())"
            )
            origin_c = f"'{home}'"
            tr_c = f"'{tr_id}'"
            cross_cnt += 1
        else:
            origin_c = "NULL"
            tr_c = "NULL"

        all_parts.append(
            f"('{pid}', '{sid}', '{target}', {origin_c}, '{h['membership_id']}', 'hostess', "
            f"'{cat}', {tm}, {price}, {mdeduct}, {hpay}, 'left', "
            f"NOW() - INTERVAL '{entered_min} minutes', "
            f"NOW() - INTERVAL '{max(0, entered_min - tm)} minutes', "
            f"{tr_c}, NOW(), NOW())"
        )

print(f"준비된 row: participants {len(all_parts)}, transfer {len(all_transfers)} (cross {cross_cnt})")

# transfer_requests INSERT (schema: id, hostess_membership_id, from_store_uuid, to_store_uuid, business_day_id, status, from_store_approved_by, from_store_approved_at, to_store_approved_by, to_store_approved_at, created_at, updated_at)
CHUNK = 100
print("\ntransfer_requests INSERT...")
ok_tr = 0
for i in range(0, len(all_transfers), CHUNK):
    chunk = all_transfers[i:i+CHUNK]
    try:
        sql(f"INSERT INTO transfer_requests (id, hostess_membership_id, from_store_uuid, to_store_uuid, business_day_id, status, from_store_approved_by, from_store_approved_at, to_store_approved_by, to_store_approved_at, created_at, updated_at) VALUES {','.join(chunk)};")
        ok_tr += len(chunk)
    except Exception as e:
        print(f"  chunk {i//CHUNK} fail")
print(f"  → {ok_tr}/{len(all_transfers)} 성공")

print("\nsession_participants INSERT...")
ok_p = 0
for i in range(0, len(all_parts), CHUNK):
    chunk = all_parts[i:i+CHUNK]
    try:
        sql(f"INSERT INTO session_participants (id, session_id, store_uuid, origin_store_uuid, membership_id, role, category, time_minutes, price_amount, manager_payout_amount, hostess_payout_amount, status, entered_at, left_at, transfer_request_id, created_at, updated_at) VALUES {','.join(chunk)};")
        ok_p += len(chunk)
    except Exception as e:
        if i == 0:
            print(f"  chunk 0 fail (예시): {e}")
print(f"  → {ok_p}/{len(all_parts)} 성공")

# ─── 검증 ────────────────────────────────────────────────────────
print("\n=== 검증 ===")
# 동명이인
import urllib.parse as up
for nm in ["지연", "별", "유리", "채린", "미라"]:
    enm = up.quote(nm)
    rows = get(f"/hostesses?select=store_uuid&name=eq.{enm}&deleted_at=is.null")
    stores_set = set(r["store_uuid"] for r in rows)
    print(f"  '{nm}': {len(rows)}명 / {len(stores_set)}개 매장")
