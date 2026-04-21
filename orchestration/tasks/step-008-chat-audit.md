[ROUND]
STEP-008

[TASK TYPE]
chat audit and hardening plan

[OBJECTIVE]
현재 NOX 코드베이스에 이미 존재하는 단체채팅 / 그룹채팅 / store chat 관련 구조를 감사(audit)한다.

이번 라운드의 목표:
- 현재 채팅 구현 상태를 실제 코드 기준으로 파악
- 구조 문제, 보안 문제, 권한 문제, 스코프 문제를 식별
- 바로 수정 가능한 고위험 문제는 최소 범위에서만 수정
- 이후 단계별 개선/보강 계획을 확정

중요:
이번 라운드는 "새 채팅 기능 구현"이 아니다.
먼저 현재 구조를 파악하고 위험 요소를 찾는 감사 단계다.

[CONSTRAINTS]
1. 추측 금지. 실제 코드에 존재하는 것만 기준으로 판단한다.
2. broad refactor 금지
3. unrelated file 변경 금지
4. 기존 동작을 추측으로 재설계하지 않는다
5. store_uuid를 절대 보안 스코프로 본다
6. membership/status/role 검증이 실제로 어디서 수행되는지 코드로 확인한다
7. 인증/권한/스코프 검증은 API와 realtime 경로 모두 확인한다

[AUDIT TARGETS]
반드시 확인할 것:

1. 구조
- chat 관련 page
- component
- hook
- API route
- helper / service / realtime 연결부

2. 데이터 접근
- 어떤 테이블/뷰를 읽고 쓰는지
- store_uuid 필터가 실제로 있는지
- membership_id / user_id / profile id 중 무엇을 기준으로 쓰는지
- 클라이언트 입력을 그대로 신뢰하는 부분이 있는지

3. 권한
- 누가 채팅방에 들어갈 수 있는지
- 누가 메시지를 보낼 수 있는지
- 누가 멤버를 추가/제거할 수 있는지
- suspended / pending / rejected 사용자 차단이 있는지

4. 메시지/방 스코프
- direct / group / store 중 무엇이 이미 구현되어 있는지
- store 간 교차 접근 가능성이 있는지
- 채팅방 membership 검증이 있는지

5. realtime / unread
- 실시간 구독이 어느 범위로 열리는지
- 다른 store 메시지를 받을 가능성이 있는지
- unread / read tracking이 있으면 정확한지
- 메모리 누수 / 중복 subscription 가능성이 있는지

6. 입력 검증
- empty message 차단
- oversized payload 차단
- invalid room id 차단
- unauthorized sender 차단

[HIGH-RISK FIX RULE]
다음은 발견 즉시 최소 수정 허용:
- store_uuid scope leak
- membership verification missing
- unauthorized message send path
- direct client-trusted sender/store identifiers
- missing auth gate in chat API route

그 외는 일단 보고서 우선.

[FAIL IF]
다음 중 하나라도 발생하면 실패다.

1. 실제 코드 확인 없이 추측 보고
2. unrelated 파일 대량 수정
3. broad refactor 강행
4. 채팅 구조를 새로 발명
5. store scope 보안 검토 누락
6. membership 검증 검토 누락

[COMPLETE IF]
다음을 모두 만족하면 완료다.

1. 현재 chat 구조를 실제 파일 기준으로 설명
2. 보안 문제를 구체적으로 식별
3. 구조 문제를 구체적으로 식별
4. 최소 수정한 부분이 있다면 파일/이유를 명확히 보고
5. 다음 단계 repair plan을 우선순위로 제시

[ALLOWED_FILES]
- existing chat-related files only
- minimal directly related auth/scope helpers only if required for a high-risk fix

주의:
채팅과 무관한 파일은 수정 금지.
새 파일 생성은 원칙적으로 금지. 단, 보고 목적 문서 출력은 제외.

[FORBIDDEN_FILES]
- unrelated counter files
- unrelated settlement files
- package.json
- tsconfig.json
- next.config.*
- broad orchestration rule files

[OUTPUT FORMAT]
최종 보고는 아래 형식만 사용한다.

1. CHAT FILES FOUND
2. CURRENT CHAT ARCHITECTURE
3. SECURITY / SCOPE FINDINGS
4. STRUCTURAL FINDINGS
5. HIGH-RISK FIXES APPLIED (if any)
6. RECOMMENDED NEXT STEPS
7. AUDIT COMPLETE 여부

[STOP CONDITIONS]
다음 상황이면 그대로 보고:
- chat 관련 구현이 생각보다 거의 없어서 감사 대상이 부족한 경우
- 핵심 파일이 손상/누락되어 구조 해석이 불가능한 경우
- 보안 문제 수정에 광범위한 리팩토링이 필요한 경우

이 경우 억지 수정하지 말고 현재 확인 가능한 범위만 보고한다.