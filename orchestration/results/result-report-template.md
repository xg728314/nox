# NOX RESULT REPORT TEMPLATE (LOCKED)

[RESULT STATUS]
PASS
or
FAIL
or
REVIEW

[FILES CHANGED]
- C:\work\nox\path\to\changed-file.ext

[ROOT CAUSE]
- 이 수정이 왜 필요했는지 설명
- 문제의 직접 원인 설명

[EXACT DIFF SUMMARY]
- 정확히 어떤 변경을 했는지
- 추가 / 수정 / 삭제 내용을 구분해서 작성

[VALIDATION]
- 실행한 검증 항목
- 검증 결과
- PASS / FAIL 명시

예시:
- Type check: PASS
- Target file only check: PASS
- Forbidden file modification check: PASS

[KNOWN LIMITS]
- 현재 결과의 제한사항
- 아직 해결되지 않은 부분
- 이번 TASK 범위 밖이라 남겨둔 부분

[NEXT BLOCKER]
- 다음 단계로 가기 전에 막고 있는 요소
- 추가 확인이 필요한 요소
- 상위 문서/정의와 충돌 가능성

[SCOPE CHECK]
- TARGET FILE 준수 여부
- ALLOWED FILES 준수 여부
- FORBIDDEN FILES 침범 여부
- STEP 범위 위반 여부

[REFERENCE USED]
- none
or
- C:\work\wind\...
- why referenced:
- decision: reused concept only / discarded / reimplemented

[FINAL NOTE]
- 이 결과가 현재 STEP 기준에 맞는지
- 자동 진행 가능 여부
