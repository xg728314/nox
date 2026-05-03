#!/usr/bin/env python3
"""NOX DB Backup Verification — quarterly scripted check.

목적:
  scripts/db-backup-restore.md 의 "분기별 시연 절차" 를 1단계 자동화.
  branch DB 에 연결해서 production 과 동일한 행 수가 있는지 즉시 검증.

흐름:
  1. branch endpoint 환경변수 확인 (NOX_BRANCH_DB_URL)
  2. production 환경변수 확인 (NEXT_PUBLIC_SUPABASE_URL + SERVICE_ROLE_KEY)
  3. 핵심 테이블 행 수를 양쪽에서 SELECT
  4. 차이 비교
  5. 결과를 evidence file 로 기록 + stdout

사용:
  set NEXT_PUBLIC_SUPABASE_URL=https://piboecawkeqahyqbcize.supabase.co
  set SUPABASE_SERVICE_ROLE_KEY=...
  set NOX_BRANCH_DB_URL=https://<branch-id>.supabase.co
  set NOX_BRANCH_SERVICE_KEY=...
  python scripts/db-backup-verify.py

이 script 는 production 데이터를 절대 변경하지 않음. SELECT only.
"""

import json
import os
import sys
from datetime import datetime
import requests

# 핵심 테이블 — 행 수가 production 과 같아야 함.
CRITICAL_TABLES = [
    "stores",
    "store_memberships",
    "rooms",
    "room_sessions",
    "session_participants",
    "orders",
    "receipts",
    "audit_events",
    "store_settings",
    "store_service_types",
    "operating_days",
    "credits",
    "cafe_menu_items",
    "cafe_orders",
]


def get_env(name: str) -> str:
    v = os.environ.get(name, "")
    if not v:
        print(f"[backup-verify] Missing env: {name}", file=sys.stderr)
        sys.exit(2)
    return v


def count_table(supa_url: str, service_key: str, table: str) -> int | None:
    """Return row count or None on error."""
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Prefer": "count=exact",
        "Range-Unit": "items",
        "Range": "0-0",
    }
    try:
        r = requests.head(
            f"{supa_url}/rest/v1/{table}?select=*",
            headers=headers,
            timeout=15,
        )
        cr = r.headers.get("Content-Range") or r.headers.get("content-range") or ""
        # format: "0-0/N" or "*/N"
        if "/" in cr:
            return int(cr.split("/")[-1])
        return None
    except Exception as e:
        print(f"[backup-verify] count failed for {table}: {e}", file=sys.stderr)
        return None


def main() -> int:
    prod_url = get_env("NEXT_PUBLIC_SUPABASE_URL")
    prod_key = get_env("SUPABASE_SERVICE_ROLE_KEY")
    branch_url = os.environ.get("NOX_BRANCH_DB_URL", "")
    branch_key = os.environ.get("NOX_BRANCH_SERVICE_KEY", "")

    if not branch_url or not branch_key:
        print("\n[INFO] NOX_BRANCH_DB_URL / NOX_BRANCH_SERVICE_KEY not set.")
        print("       Production-only mode — only printing prod baseline.")
        print("       Create a branch in Supabase Dashboard, then re-run with both URLs to compare.\n")

    print(f"[backup-verify] starting at {datetime.utcnow().isoformat()}")
    print(f"  prod={prod_url}")
    if branch_url:
        print(f"  branch={branch_url}")

    rows: list[dict] = []
    pass_count = 0
    fail_count = 0
    for t in CRITICAL_TABLES:
        prod_n = count_table(prod_url, prod_key, t)
        branch_n = count_table(branch_url, branch_key, t) if branch_url else None
        ok: bool | None = None
        if branch_url:
            ok = (prod_n is not None and branch_n is not None and prod_n == branch_n)
            if ok:
                pass_count += 1
            else:
                fail_count += 1
        rows.append({"table": t, "prod": prod_n, "branch": branch_n, "match": ok})
        log_line = f"  {t:<30} prod={prod_n}"
        if branch_url:
            mark = "OK" if ok else "DIFF"
            log_line += f"   branch={branch_n}   [{mark}]"
        print(log_line)

    print(f"\n  PASS: {pass_count}  FAIL: {fail_count}")
    quarter = (datetime.utcnow().month - 1) // 3 + 1
    yyyy = datetime.utcnow().year
    evidence = {
        "verified_at": datetime.utcnow().isoformat(),
        "prod_url": prod_url,
        "branch_url": branch_url,
        "rows": rows,
        "result": "PASS" if fail_count == 0 and branch_url else ("BASELINE_ONLY" if not branch_url else "FAIL"),
        "quarter": f"{yyyy}-Q{quarter}",
    }
    print("\n--- evidence (copy into ops/backup-restore-drill/{}-Q{}.md): ---".format(yyyy, quarter))
    print(json.dumps(evidence, indent=2, ensure_ascii=False))

    return 0 if fail_count == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
