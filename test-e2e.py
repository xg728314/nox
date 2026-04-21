import requests, sys, json

TOKEN = sys.argv[1]
SID = sys.argv[2]
print(f"SESSION_ID: {SID}")
BASE = "http://localhost:3001/api/sessions"
HEADERS = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}

def api_post(path, body):
    url = f"{BASE}/{path}"
    r = requests.post(url, json=body, headers=HEADERS)
    return r.status_code, r.json()

steps = [
    ("2/6", "participants", {
        "session_id": SID,
        "membership_id": "2d139a29-2dfb-4e4c-a567-0448a17811e5",
        "role": "hostess",
        "category": "\ud37c\ube14\ub9ad",
        "time_minutes": 90
    }),
    ("3/6", "orders", {
        "session_id": SID,
        "item_name": "\uc591\uc8fc",
        "order_type": "beverage",
        "qty": 1,
        "unit_price": 50000
    }),
    ("4/6", "checkout", {"session_id": SID}),
    ("5/6", "settlement", {"session_id": SID}),
    ("6/6", "receipt", {"session_id": SID}),
]

for label, path, body in steps:
    print(f"\n{'='*40}")
    print(f"  [{label}] POST /api/sessions/{path}")
    print(f"{'='*40}")
    code, data = api_post(path, body)
    print(f"HTTP {code}")
    print(json.dumps(data, indent=2, ensure_ascii=False))
    if code >= 400:
        print(f"  >> FAILED at step {label}")
        # continue anyway for visibility

print(f"\n{'='*40}")
print("  E2E TEST COMPLETE")
print(f"{'='*40}")
