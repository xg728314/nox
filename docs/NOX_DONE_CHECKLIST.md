# NOX DONE CHECKLIST (LOCKED)

## 0. PURPOSE
이 문서는 각 STEP 완료 여부를 판단하는 기준이다.

모든 STEP은 이 체크리스트를 통과해야 다음 단계로 이동 가능하다.

---

## 1. GLOBAL RULE

- 하나라도 FAIL이면 다음 STEP 금지
- PASS 기준 명확히 확인

---

## 2. STEP 1 CHECKLIST (AUTH)

- 회원가입 성공
- 로그인 성공
- 승인 흐름 정상
- 승인 전 접근 차단
- 토큰 인증 정상 동작
- store_uuid 연결 확인

---

## 3. STEP 2 CHECKLIST (STRUCTURE)

- store 생성 가능
- floor 생성 가능
- room 생성 가능
- room 조회 가능
- room 상태 정상 반영

---

## 4. STEP 3 CHECKLIST (SESSION)

- 세션 생성 가능
- 같은 방 중복 세션 방지
- 참여자 추가 가능
- 참여자 제거 가능
- 세션 종료 가능
- 종료 후 수정 차단

---

## 5. STEP 4 CHECKLIST (SETTLEMENT)

- 시간 계산 정상
- 오더 추가 정상
- 금액 계산 정상
- 음수 금액 없음
- 정산 결과 저장 정상
- 중복 저장 방지

---

## 6. STEP 5 CHECKLIST (VALIDATION)

- owner 홈 표시 정상
- room 상태 표시 정상
- action log 기록 정상
- cross-store 접근 차단 확인
- 권한 제한 정상 동작

---

## 7. FINAL MVP CHECK

- 1룸 세션 흐름 정상 동작
- 참여자 등록 정상
- 정산 결과 정상
- 로그 정상 기록
- 보안 기본 규칙 유지

---

## 8. FINAL RULE

완료 기준은 "작동"이 아니라 "검증된 작동"이다.

확인 없이 다음 단계로 가면
반드시 다시 돌아오게 된다.
