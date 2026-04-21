FILES CHANGED:
- orchestration/docs/NOX_OPERATION_PLAYBOOK.md
- orchestration/docs/NOX_AUTO_LOOP_SPEC.md

ROOT CAUSE:
- controlled automation 구조는 완성됐지만, 실제 운영자가 어떤 모드를 언제 어떻게 실행해야 하는지에 대한 운영 매뉴얼이 고정되지 않았음
- manual / bridge assisted / controlled auto-cycle 실행 절차와 실패 대응 기준을 재현 가능하게 문서화할 필요가 있었음

EXACT DIFF:
- NOX_OPERATION_PLAYBOOK.md 신규 생성
- Manual mode, Bridge Assisted mode, Controlled Auto-Cycle mode 실행 절차 추가
- mode selection guide, failure handling, file path map, do/don't rules 추가
- NOX_AUTO_LOOP_SPEC.md에 운영 playbook 참조 및 운영 프로파일 정렬 반영

VALIDATION:
- mode clarity check: PASS
- execution reproducibility check: PASS
- operator usability check: PASS
- no product scope change check: PASS