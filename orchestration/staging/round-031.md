FILES CHANGED:
- orchestration/scripts/executor-bridge.ps1
- orchestration/scripts/run-round.ps1
- orchestration/docs/NOX_AUTO_LOOP_SPEC.md

ROOT CAUSE:
- executor bridge의 clipboard/file 실운영 검증이 아직 완료되지 않았음
- malformed clipboard 입력 차단, auto-save, fallback 동작을 실제 실행 기준으로 검증할 필요가 있었음

EXACT DIFF:
- clipboard mode 호출 및 result contract 검증 동작을 실검증
- malformed clipboard 입력이 차단되는지 확인
- manual fallback 동작을 확인
- file mode auto-save 경로를 검증하기 위한 staging result를 준비

VALIDATION:
- clipboard mode check: FAIL in current environment
- file mode check: PASS
- malformed result rejection check: PASS
- overwrite guard check: PENDING
- fallback check: PASS
- no product scope change check: PASS
