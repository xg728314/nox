"""
채팅 cross-store 교차검증 시뮬레이션.
  - 매장간 dispatch 패턴 메시지를 채팅으로 전송
  - 각 메시지에 동명이인 매장 (예: 두바이 2개) 포함
  - parser 가 store_uuid 정확히 식별하는지 검증
  - 임시 등록 (chat_pattern_dispatches) + confirm flow 부분 자동화
"""
import json, urllib.request, sys, io, random
from datetime import datetime, timezone
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBpYm9lY2F3a2VxYWh5cWJjaXplIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTc0OTQyMiwiZXhwIjoyMDkxMzI1NDIyfQ._cxZQy95QvaLz8rOmEnn3wUiUyKnTNSzYzdOX1JL4b4"
BASE = "https://piboecawkeqahyqbcize.supabase.co/rest/v1"
H = {"apikey":KEY,"Authorization":f"Bearer {KEY}","Content-Type":"application/json","Prefer":"return=representation"}

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
        print(f"  ✗ {method} {path[:80]} → {e.code}: {body_txt[:200]}", flush=True)
        return None

def get(p): return req("GET", p)
def post(p, b): return req("POST", p, b)

print("=== 채팅 cross-store 시뮬레이션 ===\n")

# 1. 글로벌 채팅방 찾기 (또는 첫 번째 channel)
rooms = get("/chat_rooms?select=id,store_uuid,type,name&type=eq.global&deleted_at=is.null&limit=5")
if not rooms:
    print("⚠ 글로벌 채팅방 없음 — 새로 만들기")
    sys.exit(1)
print(f"채팅방 발견: {len(rooms)}개")

# 2. 신세계 매장 (sender) 찾기
ss = get("/stores?select=id,store_name&store_name=eq.%EC%8B%A0%EC%84%B8%EA%B3%84")
if not ss:
    print("⚠ 신세계 매장 없음")
    sys.exit(1)
sse_uuid = ss[0]["id"]
print(f"신세계 store: {sse_uuid[:8]}")

# 3. 신세계 매니저 찾기
mgrs = get(f"/store_memberships?select=id,profile_id&store_uuid=eq.{sse_uuid}&role=eq.manager&status=eq.approved&limit=1")
if not mgrs:
    print("⚠ 신세계 매니저 없음")
    sys.exit(1)
mgr_id = mgrs[0]["id"]
print(f"신세계 매니저 membership: {mgr_id[:8]}")

# 4. 신세계 채팅방
ss_room = next((r for r in rooms if r["store_uuid"] == sse_uuid), None)
if not ss_room:
    print("⚠ 신세계 글로벌 채팅방 없음")
    sys.exit(1)
ss_room_id = ss_room["id"]
print(f"신세계 채팅방: {ss_room_id[:8]}\n")

# 5. 시뮬 메시지 (cross-store dispatch 패턴 — 동명이인 매장 포함)
TEST_MESSAGES = [
    "마 지연 셔츠 / 버 지연 퍼블릭",   # 동명이인 (마블 지연, 버닝 지연)
    "두 채아 셔 / 라 예린 퍼 / 마 별 하",  # 3매장 3식구
    "신 지유 셔츠 반티",                  # 본 매장 (cross 아님)
    "발 하늘 하퍼 차3",                   # 발리 2개 매장 → 어느 발리?
    "토 미나 퍼블릭",                    # 토끼 2개 매장 → 어느 토끼?
    "버 미연 셔 / 라 다은 퍼 / 마 채린 하",  # 다양한 매장
    "황 보영 퍼블릭 완티",
    "썸 다현 셔츠 반티",
    "파 보라 하퍼",
    "두 은비 셔 차3 / 두 가람 퍼",         # 같은 메시지 같은 매장(두바이) 2명
]

print("=== 메시지 전송 ===")
sent_msgs = []
for i, content in enumerate(TEST_MESSAGES):
    msg = post("/chat_messages", {
        "chat_room_id": ss_room_id,
        "store_uuid": sse_uuid,
        "sender_membership_id": mgr_id,
        "content": content,
        "message_type": "text",
    })
    if msg:
        sent_msgs.append({"id": msg[0]["id"], "content": content})
        print(f"  [{i+1:2d}] {content}")
    else:
        print(f"  ✗ FAIL: {content}")

print(f"\n총 {len(sent_msgs)}개 메시지 전송 완료")

# 6. 잠시 후 chat_pattern_dispatches 확인 (parser 가 동작했는지)
import time
print("\n10초 대기 (parser 동작 시간)...")
time.sleep(10)

print("\n=== chat_pattern_dispatches 검증 ===")
for sm in sent_msgs:
    disps = get(f"/chat_pattern_dispatches?select=*&chat_message_id=eq.{sm['id']}")
    print(f"\n메시지 \"{sm['content']}\"")
    if disps:
        for d in disps:
            print(f"  → store={d['target_store_uuid'][:8]}, hostess_mid={d['hostess_membership_id'][:8]}, {d['category']}/{d['time_type']}, status={d['status']}")
    else:
        print("  (dispatch 미생성 — 운영자가 '임시 등록' 버튼을 눌러야 함)")

print("\n=== 완료 ===")
print("UI 에서 신세계 채팅방 열어서:")
print("  - 메시지마다 '🎯 자동 인식' 카드 보이는지")
print("  - '📝 임시 등록' 누르면 dispatches 생성되는지")
print("  - 동명이인 매장 (두바이 2개, 발리 2개, 토끼 2개) 가 어떻게 표시되는지")
