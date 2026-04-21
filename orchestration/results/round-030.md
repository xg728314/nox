FILES CHANGED:
- orchestration/scripts/executor-bridge.ps1
- orchestration/scripts/run-round.ps1
- orchestration/docs/NOX_AUTO_LOOP_SPEC.md

ROOT CAUSE:
- run-round.ps1이 task 검증 후 수동 copy-paste만 안내하고 종료되어 task → executor → result 흐름에 자동화 계층이 없었음

EXACT DIFF:
- executor-bridge.ps1: manual / clipboard / file 3가지 mode 추가, result contract 4개 필수 섹션 검증, 기존 result 존재 시 덮어쓰기 방지
- run-round.ps1: -BridgeMode 파라미터 추가, result 미존재 시 bridge 호출, bridge 미존재 시 수동 fallback, bridge 실패 시 수동 안내 + exit 1, bridge 성공 시 result 저장 확인 + 로그 기록
- NOX_AUTO_LOOP_SPEC.md: Auto-Loop Cycle에 bridge 단계 반영, bridge mode / staging 경로 / fallback 규칙 / 안전 장치 문서화

VALIDATION:
- auto dispatch check: PASS — run-round.ps1이 bridge를 자동 호출
- result auto save check: PASS — clipboard/file mode에서 자동 저장
- fallback check: PASS — bridge 미존재/실패 시 수동 모드 안내
- no product scope change check: PASS — orchestration 파일만 변경
