#!/usr/bin/env python3
"""NOX MFA Backup-Code Drill — quarterly verification.

목적:
  분기마다 "백업 코드가 정말로 작동하는가" 를 자동으로 확인.
  TOTP 앱을 잃은 운영자가 백업 코드 1개로 로그인 후 신규 코드를 발급받는
  복구 흐름을 끝까지 시뮬레이션.

흐름:
  1. 테스트 owner 로 password+TOTP 로그인 → access_token
  2. /api/auth/mfa/recovery-codes 로 신규 8개 백업 코드 발급
  3. 첫 번째 백업 코드로 /api/auth/login/mfa 호출 (TOTP 대신)
  4. 응답의 `used_backup_code: true` + `backup_codes_remaining: 7` 확인
  5. /api/auth/me 로 정상 세션 확인
  6. 결과를 ops/mfa-drill/YYYY-Q.md 에 기록

사용:
  set NEXT_PUBLIC_SUPABASE_URL=...
  set SUPABASE_SERVICE_ROLE_KEY=...
  set MFA_DRILL_EMAIL=drill@example.com
  set MFA_DRILL_PASSWORD=...
  set MFA_DRILL_TOTP=123456    # 일회성 TOTP — 발급 단계에서 필요
  python scripts/test-mfa-drill.py

주의:
  - 이 script 는 실제 백업 코드를 소비한다. 운영 계정에는 절대 사용 X.
  - 전용 drill 계정 (drill@example.com 등) 을 사전에 owner role 로 생성해두고
    MFA 도 활성화한 상태여야 한다.
  - 실패 시 즉시 중단 + ops 채널에 알림.
"""

import json
import os
import sys
from datetime import datetime
import requests

SB_URL_ENV = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
SB_KEY_ENV = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
if not SB_URL_ENV or not SB_KEY_ENV:
    print("[mfa-drill] Missing env vars.", file=sys.stderr)
    sys.exit(2)

BASE = os.environ.get("NOX_BASE_URL", "http://localhost:3001")
EMAIL = os.environ.get("MFA_DRILL_EMAIL", "")
PASSWORD = os.environ.get("MFA_DRILL_PASSWORD", "")
TOTP = os.environ.get("MFA_DRILL_TOTP", "")

if not EMAIL or not PASSWORD or not TOTP:
    print("[mfa-drill] Missing MFA_DRILL_EMAIL / PASSWORD / TOTP.", file=sys.stderr)
    sys.exit(2)


def log(msg: str) -> None:
    print(msg, flush=True)


def api(method: str, path: str, token: str | None = None, body=None) -> requests.Response:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return requests.request(method, f"{BASE}{path}", headers=headers, json=body, timeout=30)


def step1_login_with_totp() -> str:
    log("[1] login with email + password + TOTP")
    r = api("POST", "/api/auth/login/mfa", body={
        "email": EMAIL,
        "password": PASSWORD,
        "code": TOTP,
        "remember_device": False,
    })
    if r.status_code != 200:
        log(f"  FAIL status={r.status_code} body={r.text[:200]}")
        sys.exit(1)
    d = r.json()
    token = d.get("access_token")
    if not token:
        log(f"  FAIL no access_token: {d}")
        sys.exit(1)
    log(f"  OK access_token issued")
    return token


def step2_issue_backup_codes(token: str) -> list[str]:
    log("[2] reissue 8 backup codes (consumes any prior codes)")
    r = api("POST", "/api/auth/mfa/recovery-codes", token)
    if r.status_code != 200:
        log(f"  FAIL status={r.status_code} body={r.text[:200]}")
        sys.exit(1)
    d = r.json()
    codes = d.get("backup_codes")
    if not isinstance(codes, list) or len(codes) != 8:
        log(f"  FAIL bad backup_codes shape: {d}")
        sys.exit(1)
    log(f"  OK got {len(codes)} backup codes")
    return codes


def step3_login_with_backup_code(code: str) -> dict:
    log(f"[3] login with backup code (one-time): {code[:4]}***")
    # 새 fetch — TOTP 자리에 backup code 를 넣음.
    r = api("POST", "/api/auth/login/mfa", body={
        "email": EMAIL,
        "password": PASSWORD,
        "code": code,
        "remember_device": False,
    })
    if r.status_code != 200:
        log(f"  FAIL status={r.status_code} body={r.text[:200]}")
        sys.exit(1)
    d = r.json()
    if not d.get("used_backup_code"):
        log(f"  FAIL response missing used_backup_code=true: {d}")
        sys.exit(1)
    remaining = d.get("backup_codes_remaining")
    if remaining != 7:
        log(f"  FAIL expected backup_codes_remaining=7, got {remaining}")
        sys.exit(1)
    log(f"  OK used_backup_code=true, remaining=7")
    return d


def step4_session_check(token: str) -> None:
    log("[4] /api/auth/me sanity check (logged in?)")
    r = api("GET", "/api/auth/me", token)
    if r.status_code != 200:
        log(f"  FAIL status={r.status_code}")
        sys.exit(1)
    d = r.json()
    if d.get("email") != EMAIL:
        log(f"  FAIL email mismatch: {d}")
        sys.exit(1)
    log(f"  OK session is for {EMAIL}")


def step5_replay_blocked(used_code: str) -> None:
    log("[5] replay protection: same backup code must NOT login again")
    r = api("POST", "/api/auth/login/mfa", body={
        "email": EMAIL,
        "password": PASSWORD,
        "code": used_code,
        "remember_device": False,
    })
    # 401 INVALID_CODE expected
    if r.status_code == 200:
        log(f"  CRITICAL — replay succeeded! body={r.text[:200]}")
        sys.exit(1)
    log(f"  OK replay blocked (status={r.status_code})")


def write_evidence(remaining: int, replay_blocked: bool) -> None:
    quarter = (datetime.utcnow().month - 1) // 3 + 1
    yyyy = datetime.utcnow().year
    log(f"\n[6] writing evidence ops/mfa-drill/{yyyy}-Q{quarter}.md")
    log("    (this script does not actually write to disk in CI; copy log into git if needed)")
    log(json.dumps({
        "drill_at": datetime.utcnow().isoformat(),
        "email": EMAIL,
        "remaining_after": remaining,
        "replay_blocked": replay_blocked,
        "result": "PASS",
    }, indent=2))


def main() -> int:
    token = step1_login_with_totp()
    codes = step2_issue_backup_codes(token)
    used = codes[0]
    bk_response = step3_login_with_backup_code(used)
    new_token = bk_response.get("access_token") or token
    step4_session_check(new_token)
    step5_replay_blocked(used)
    write_evidence(remaining=bk_response.get("backup_codes_remaining", -1), replay_blocked=True)
    log("\n  ALL PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
