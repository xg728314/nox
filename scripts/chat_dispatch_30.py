"""
신세계 매장 전체 채팅방에 30개 cross-store dispatch 메시지 전송.
  - 다양한 매장 + 동명이인 식구
  - 종목 / 시간 다양
  - 동명 매장 (두바이/발리/토끼/블랙 2개씩) 포함 → parser 정확도 검증
"""
import json, urllib.request, sys, io, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBpYm9lY2F3a2VxYWh5cWJjaXplIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTc0OTQyMiwiZXhwIjoyMDkxMzI1NDIyfQ._cxZQy95QvaLz8rOmEnn3wUiUyKnTNSzYzdOX1JL4b4"
BASE = "https://piboecawkeqahyqbcize.supabase.co/rest/v1"
H = {"apikey":KEY,"Authorization":f"Bearer {KEY}","Content-Type":"application/json","Prefer":"return=representation"}

def get(p):
    return json.loads(urllib.request.urlopen(urllib.request.Request(BASE+p, headers={k:v for k,v in H.items() if k != "Content-Type"})).read())

def post(p, b):
    r = urllib.request.Request(BASE+p, data=json.dumps(b).encode(), headers=H, method="POST")
    try:
        return json.loads(urllib.request.urlopen(r).read())
    except urllib.error.HTTPError as e:
        print(f"  ✗ {e.code}: {e.read().decode()[:200]}")
        return None

# 신세계 (bcc1a8c3) 의 글로벌 채팅방
sse_uuid = "bcc1a8c3-b8bd-4278-a1b4-ea3ed0716f65"
rooms = get(f"/chat_rooms?select=id,type&store_uuid=eq.{sse_uuid}&type=eq.global&deleted_at=is.null&limit=1")
if not rooms:
    print("⚠ 신세계 글로벌 채팅방 없음")
    sys.exit(1)
room_id = rooms[0]["id"]
print(f"신세계 글로벌 채팅방: {room_id}")

# sender = 신세계 매니저
mgrs = get(f"/store_memberships?select=id,profile_id&store_uuid=eq.{sse_uuid}&role=eq.manager&status=eq.approved&limit=1")
mgr_id = mgrs[0]["id"]
print(f"sender 매니저: {mgr_id}\n")

# ─── 30개 메시지 — 풍부한 cross-store + 동명이인 + 동명 매장 ────
MSGS = [
    # 동명이인 (같은 이름, 다른 매장)
    "마 지효 셔츠 / 버 지효 퍼블릭",
    "라 수민 하퍼 / 황 수민 셔츠",
    "두 예린 퍼블릭 / 토 예린 셔츠",
    "파 채린 셔츠 반티 / 블 채린 퍼블릭",
    "발 나래 하퍼 차3 / 상 나래 셔츠",

    # 3매장 3식구 한 메시지
    "마 유나 셔 / 라 다은 퍼 / 버 보영 하",
    "두 가은 퍼 / 황 소희 셔 / 토 윤지 퍼",
    "파 미라 셔 / 발 하늘 하 / 블 지연 퍼",
    "썸 채은 셔 / 상 서연 퍼 / 버 유리 하",
    "마 하영 셔 / 라 지유 퍼 / 황 채아 셔",

    # 동명 매장 (두바이 2개, 발리 2개, 토끼 2개 등)
    "두 다은 셔츠 완티",
    "두 다은 퍼블릭 반티",
    "발 보영 셔츠 / 발 하늘 하퍼",
    "토 예린 셔 / 토 채린 퍼",
    "블 미라 하 / 블 지연 셔",
    "파 윤지 셔 / 파 가은 퍼",

    # 단일 식구
    "썸 다은 셔츠 반티",
    "황 지효 하퍼 차3",
    "라 보영 퍼블릭 완티",
    "마 채아 셔츠",

    # 같은 매장 여러 식구
    "신 지효 셔 / 신 수민 퍼 / 신 예린 하",   # 본 매장 — cross 아님
    "마 다은 셔 / 마 보영 셔 / 마 윤지 퍼",
    "라 채린 퍼 / 라 가은 셔 / 라 나래 하",

    # 시간 옵션 풍부
    "버 지유 셔츠 완티",
    "버 지유 셔츠 반티",
    "버 지유 셔츠 차3",

    # 잘못된/미매칭 케이스 (parser stress test)
    "마 지연 (메모: 첫 손님)",                  # 메모 섞임
    "라 미연 퍼블릭",                            # '미연' 은 풀에 적음 → 미매칭 가능
    "두 예린 셔 1타임 / 발 채린 퍼 2타임",     # 타임 수 표시
    "파 수민 셔 차3 / 토 가은 퍼 차3 / 블 지효 셔 반티",  # 3매장 3식구 시간 다름
]

print(f"=== 메시지 {len(MSGS)}개 전송 ===\n")
sent = 0
for i, content in enumerate(MSGS, 1):
    msg = post("/chat_messages", {
        "chat_room_id": room_id,
        "store_uuid": sse_uuid,
        "sender_membership_id": mgr_id,
        "content": content,
        "message_type": "text",
    })
    if msg:
        sent += 1
        print(f"  [{i:2d}] {content}")
        time.sleep(0.1)  # 100ms 간격 (1분당 ~600 — 사용자 목표 1분당 20개 훨씬 초과 가능)
    else:
        print(f"  ✗ [{i:2d}] {content}")

print(f"\n✓ 전송 완료: {sent}/{len(MSGS)}건")
print("\nUI 확인 포인트:")
print("  1. 신세계 채팅방 — 30개 메시지 모두 자동 인식 카드 표시")
print("  2. 동명이인 (지효 등) 가 어느 매장 표시되는지 (마블 vs 버닝)")
print("  3. 동명 매장 (두바이 2개) — 어느 두바이 표시되는지 / 미매칭")
print("  4. 미매칭 (미연) 카드 어떻게 표시되는지")
print("  5. 본 매장 식구 (신 지효 등) — cross-store 아님 표시")
