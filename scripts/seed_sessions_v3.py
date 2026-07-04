"""
세션 + participants 시뮬레이션 v3.
  - transfer_requests FK 는 profiles → 매니저 profile_id 사용
  - 한글 검색 인코딩 수정
"""
import json, urllib.request, sys, io, random, uuid
import urllib.parse as up
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBpYm9lY2F3a2VxYWh5cWJjaXplIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTc0OTQyMiwiZXhwIjoyMDkxMzI1NDIyfQ._cxZQy95QvaLz8rOmEnn3wUiUyKnTNSzYzdOX1JL4b4"
BASE = "https://piboecawkeqahyqbcize.supabase.co/rest/v1"
H = {"apikey":KEY,"Authorization":f"Bearer {KEY}","Content-Type":"application/json"}

def sql(q):
    r = urllib.request.Request(BASE+"/rpc/exec_sql", data=json.dumps({"sql": q}).encode(), headers=H, method="POST")
    try:
        return urllib.request.urlopen(r).read().decode()
    except urllib.error.HTTPError as e:
        raise Exception(f"{e.code}: {e.read().decode()[:300]}")

def get(p):
    r = urllib.request.Request(BASE+p, headers={k:v for k,v in H.items() if k != "Content-Type"})
    return json.loads(urllib.request.urlopen(r).read())

random.seed(99)

print("=== 매장 + 매니저 profile_id ===")
stores = get("/stores?select=id,store_name,floor&deleted_at=is.null")
ops_stores = [s for s in stores if "TEST" not in s["store_name"] and "카페" not in s["store_name"] and "Café" not in s["store_name"]]
print(f"운영 매장 {len(ops_stores)}개")

# manager 의 membership_id → profile_id 매핑
mgr_profile = {}  # membership_id -> profile_id
for s in ops_stores:
    mgrs = get(f"/store_memberships?select=id,profile_id&store_uuid=eq.{s['id']}&role=eq.manager&status=eq.approved")
    for m in mgrs:
        if m.get("profile_id"):
            mgr_profile[m["id"]] = m["profile_id"]

# 식구 — 매니저 profile 있는 것만
print("식구 조회 중...")
all_hostesses = []
for s in ops_stores:
    hs = get(f"/hostesses?select=membership_id,name,manager_membership_id,store_uuid&store_uuid=eq.{s['id']}&deleted_at=is.null")
    for h in hs:
        h["store_name"] = s["store_name"]
        # manager_profile lookup
        h["manager_profile_id"] = mgr_profile.get(h["manager_membership_id"])
    all_hostesses.extend(hs)
with_mgr = [h for h in all_hostesses if h["manager_profile_id"]]
print(f"총 식구: {len(all_hostesses)}명 (manager profile 있는 식구: {len(with_mgr)}명)")

# business_day + service_types
biz = {}
for s in ops_stores:
    rows = get(f"/store_operating_days?select=id,status&store_uuid=eq.{s['id']}&order=business_date.desc&limit=1")
    if rows and rows[0]["status"] == "open":
        biz[s["id"]] = rows[0]["id"]

svc = {}
for s in ops_stores:
    sts = get(f"/store_service_types?select=service_type,time_type,price,time_minutes,manager_deduction&store_uuid=eq.{s['id']}")
    svc[s["id"]] = {f"{t['service_type']}|{t['time_type']}": t for t in sts}

# 세션 — 기존 + 보충
print("active 세션 보충 중...")
ex_sessions = {}
for s in ops_stores:
    bid = biz.get(s["id"])
    if not bid: continue
    rows = get(f"/room_sessions?select=id,room_uuid&store_uuid=eq.{s['id']}&business_day_id=eq.{bid}&status=eq.active&deleted_at=is.null&limit=20")
    used = set(r["room_uuid"] for r in rows)
    ex_sessions[s["id"]] = [r["id"] for r in rows]
    all_rooms = get(f"/rooms?select=id&store_uuid=eq.{s['id']}&deleted_at=is.null&limit=20")
    free = [r["id"] for r in all_rooms if r["id"] not in used][:4]
    parts = []
    new_sids = []
    for rid in free:
        sid = str(uuid.uuid4())
        new_sids.append(sid)
        parts.append(f"('{sid}', '{s['id']}', '{rid}', '{bid}', 'active', NOW() - INTERVAL '60 minutes', NOW(), NOW())")
    if parts:
        try:
            sql(f"INSERT INTO room_sessions (id, store_uuid, room_uuid, business_day_id, status, started_at, created_at, updated_at) VALUES {','.join(parts)};")
            ex_sessions[s["id"]].extend(new_sids)
        except Exception:
            pass

print(f"매장당 평균 세션: {sum(len(v) for v in ex_sessions.values())/max(1,len(ex_sessions)):.1f}")

# ─── 세션 시뮬 ────────────────────────────────────────────────
print("\n=== 세션 시뮬레이션 ===")
CATS = ["퍼블릭", "셔츠", "하퍼"]
TIMES = ["기본", "반티", "차3"]

all_transfers = []
all_parts = []

for h in with_mgr:
    n = random.randint(6, 10)
    home = h["store_uuid"]
    mgr_pid = h["manager_profile_id"]
    for _ in range(n):
        is_cross = random.random() < 0.30
        if is_cross:
            others = [s for s in ops_stores if s["id"] != home]
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
            target_bid = biz.get(target)
            if not target_bid: continue
            # target store 의 매니저 profile 도 필요
            target_mgrs = [pid_v for pid_v in mgr_profile.values()]  # 임의
            target_mgr_pid = random.choice(target_mgrs) if target_mgrs else mgr_pid
            all_transfers.append(
                f"('{tr_id}', '{h['membership_id']}', '{home}', '{target}', '{target_bid}', 'approved', "
                f"'{mgr_pid}', NOW() - INTERVAL '{entered_min} minutes', "
                f"'{target_mgr_pid}', NOW() - INTERVAL '{entered_min} minutes', NOW(), NOW())"
            )
            origin_c = f"'{home}'"
            tr_c = f"'{tr_id}'"
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

print(f"준비된 row: participants {len(all_parts)}, transfer {len(all_transfers)}")

# ── transfer_requests INSERT (각 chunk 마다 error 1줄 출력)
CHUNK = 100
print("\ntransfer_requests INSERT...")
ok_tr = 0
for i in range(0, len(all_transfers), CHUNK):
    chunk = all_transfers[i:i+CHUNK]
    try:
        sql(f"INSERT INTO transfer_requests (id, hostess_membership_id, from_store_uuid, to_store_uuid, business_day_id, status, from_store_approved_by, from_store_approved_at, to_store_approved_by, to_store_approved_at, created_at, updated_at) VALUES {','.join(chunk)};")
        ok_tr += len(chunk)
    except Exception as e:
        if i == 0: print(f"  예시 fail: {e}")
print(f"  → {ok_tr}/{len(all_transfers)} 성공")

# ── session_participants INSERT
print("\nsession_participants INSERT...")
ok_p = 0
for i in range(0, len(all_parts), CHUNK):
    chunk = all_parts[i:i+CHUNK]
    try:
        sql(f"INSERT INTO session_participants (id, session_id, store_uuid, origin_store_uuid, membership_id, role, category, time_minutes, price_amount, manager_payout_amount, hostess_payout_amount, status, entered_at, left_at, transfer_request_id, created_at, updated_at) VALUES {','.join(chunk)};")
        ok_p += len(chunk)
    except Exception as e:
        if i == 0: print(f"  예시 fail: {e}")
print(f"  → {ok_p}/{len(all_parts)} 성공")

# ── 검증 (한글 인코딩)
print("\n=== 검증 ===")
for nm in ["지연", "별", "유리", "채린", "미라"]:
    enm = up.quote(nm)
    rows = get(f"/hostesses?select=store_uuid&name=eq.{enm}&deleted_at=is.null")
    stores_set = set(r["store_uuid"] for r in rows)
    print(f"  '{nm}': {len(rows)}명 / {len(stores_set)}개 매장")

# 신규 식구 세션 합계
print("\n=== 세션 합계 (오늘) ===")
total_today = get("/session_participants?select=id&deleted_at=is.null&limit=1")
# count 쿼리
import urllib.request as _u
req = _u.Request(BASE+"/session_participants?select=*", headers={**H, "Range-Unit": "items", "Prefer": "count=exact", "Range": "0-0"})
try:
    with _u.urlopen(req) as r:
        cr = r.headers.get("Content-Range", "?")
        print(f"  session_participants 전체 row: {cr}")
except Exception as e:
    print(f"  count fail: {e}")
