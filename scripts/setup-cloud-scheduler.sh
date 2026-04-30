#!/usr/bin/env bash
# NOX cron 자동화 설정 — Google Cloud Scheduler 7개 job 등록.
#
# 사전 조건:
#   - gcloud CLI 설치 + auth (`gcloud auth login`)
#   - PROJECT_ID 가 jojusung 으로 활성화 (`gcloud config set project jojusung`)
#   - Cloud Run 의 nox 서비스 URL 확인
#   - CRON_SECRET 값 확보 (Cloud Run 환경변수에 이미 설정된 값과 동일)
#
# 사용:
#   chmod +x scripts/setup-cloud-scheduler.sh
#   PROJECT_ID=jojusung \
#   REGION=asia-northeast3 \
#   NOX_URL=https://nox.ai.kr \
#   CRON_SECRET=<your-cron-secret> \
#     bash scripts/setup-cloud-scheduler.sh
#
# 또는 단순:
#   bash scripts/setup-cloud-scheduler.sh
#   (대화형으로 값 묻기)
#
# 한계:
#   - 이미 같은 이름의 job 이 있으면 update 가 아닌 skip 됨 (안전 정책).
#     덮어쓰려면 먼저 `gcloud scheduler jobs delete <name>` 실행.
#   - Authorization 헤더에 평문 Bearer 토큰. OIDC 인증으로 옮기려면
#     별도 라운드 필요 (Cloud Run invoker IAM role).

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-}"
REGION="${REGION:-asia-northeast3}"
NOX_URL="${NOX_URL:-}"
CRON_SECRET="${CRON_SECRET:-}"

if [[ -z "$PROJECT_ID" ]]; then
  read -rp "GCP project id (e.g., jojusung): " PROJECT_ID
fi
if [[ -z "$NOX_URL" ]]; then
  read -rp "NOX URL (e.g., https://nox.ai.kr): " NOX_URL
fi
if [[ -z "$CRON_SECRET" ]]; then
  read -rsp "CRON_SECRET (Cloud Run env value): " CRON_SECRET
  echo ""
fi

echo ""
echo "Setting up Cloud Scheduler jobs:"
echo "  PROJECT: $PROJECT_ID"
echo "  REGION:  $REGION"
echo "  URL:     $NOX_URL"
echo ""

# cron name : KST schedule : description
declare -a JOBS=(
  "nox-ble-history-reaper:0 3 * * *:BLE 히스토리 정리 (03:00 KST)"
  "nox-ble-attendance-sync:0 4 * * *:BLE 출퇴근 동기화 (04:00 KST)"
  "nox-ops-alerts-scan:0 5 * * *:이상 감지 + Telegram 알림 (05:00 KST)"
  "nox-ble-session-inference:0 6 * * *:BLE 세션 자동 추론 (06:00 KST)"
  "nox-settlement-tree-advance:0 8 * * *:정산 트리 단계 진행 (17:00 KST = UTC 08)"
  "nox-audit-archive:0 18 * * *:audit_events 90일 archive (03:00 KST)"
  "nox-system-errors-cleanup:0 19 * * *:system_errors auto-resolve (04:00 KST)"
)

# job 이름의 endpoint slug 매핑.
declare -A ENDPOINTS=(
  ["nox-ble-history-reaper"]="ble-history-reaper"
  ["nox-ble-attendance-sync"]="ble-attendance-sync"
  ["nox-ops-alerts-scan"]="ops-alerts-scan"
  ["nox-ble-session-inference"]="ble-session-inference"
  ["nox-settlement-tree-advance"]="settlement-tree-advance"
  ["nox-audit-archive"]="audit-archive"
  ["nox-system-errors-cleanup"]="system-errors-cleanup"
)

created=0
skipped=0
failed=0

for entry in "${JOBS[@]}"; do
  name="${entry%%:*}"
  rest="${entry#*:}"
  schedule="${rest%%:*}"
  desc="${rest#*:}"
  endpoint="${ENDPOINTS[$name]}"
  uri="${NOX_URL}/api/cron/${endpoint}"

  echo -n "  [$name] "

  # 이미 존재하면 skip
  if gcloud scheduler jobs describe "$name" --location="$REGION" --project="$PROJECT_ID" >/dev/null 2>&1; then
    echo "exists, skip"
    skipped=$((skipped + 1))
    continue
  fi

  if gcloud scheduler jobs create http "$name" \
    --location="$REGION" \
    --project="$PROJECT_ID" \
    --schedule="$schedule" \
    --time-zone="UTC" \
    --uri="$uri" \
    --http-method=GET \
    --headers="Authorization=Bearer ${CRON_SECRET},User-Agent=Cloud-Scheduler-NOX" \
    --attempt-deadline=540s \
    --description="$desc" \
    >/dev/null 2>&1; then
    echo "created"
    created=$((created + 1))
  else
    echo "FAILED — manual create required"
    failed=$((failed + 1))
  fi
done

echo ""
echo "Summary: created=$created, skipped=$skipped, failed=$failed"
echo ""
echo "확인:"
echo "  gcloud scheduler jobs list --location=$REGION --project=$PROJECT_ID"
echo ""
echo "수동 trigger (heartbeat 즉시 확인용):"
echo "  gcloud scheduler jobs run nox-ops-alerts-scan --location=$REGION --project=$PROJECT_ID"
echo ""
echo "DB heartbeat 확인 (Supabase SQL editor):"
echo "  SELECT cron_name, last_run_at, run_count_total"
echo "  FROM cron_heartbeats ORDER BY last_run_at DESC NULLS LAST;"
