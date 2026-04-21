\# 🔴 NOX 3-ROLE PRODUCT SEPARATION RULES (LOCKED)



\## 0. 목적



NOX 시스템은

카운터 / 실장 / 아가씨 3개 역할을 분리된 UI로 제공하되,

하나의 통합 시스템으로 유지한다.



이 문서는:



\* 분리는 허용

\* 분열은 금지

&#x20; 를 명확히 하기 위한 기준이다.



\---



\## 1. 절대 원칙 (NON-NEGOTIABLE)



\### 1.1 시스템은 1개다



\* DB = 1개

\* Backend = 1개

\* Auth = 1개

\* Membership = 1개

\* Settlement Ledger = 1개



역할별로 시스템을 나누지 않는다.



\---



\### 1.2 데이터 원장은 하나다



모든 계산은 아래 단일 구조에서 발생한다:



\* session

\* session\_participants

\* orders / usage

\* settlement



카운터 / 실장 / 아가씨는

같은 데이터를 다른 시점으로 본다.



\---



\### 1.3 Identity 규칙 고정



\* session\_id = runtime identity

\* room\_uuid = canonical room identity

\* store\_uuid = security scope

\* room\_no = display only (절대 식별 금지)



\---



\### 1.4 Store Scope 절대 고정



모든 데이터 접근은 반드시:



authContext.store\_uuid



기준으로 제한된다.



클라이언트 입력으로 store scope 해석 금지.



\---



\### 1.5 Auth / Membership SSOT



\* 모든 권한 판단은 authContext 기반

\* membership 상태가 권한의 기준



UI에서 따로 권한 해석 금지.



\---



\## 2. 허용되는 분리 (ALLOWED)



\### 2.1 UI 분리



\* counter shell

\* manager shell

\* hostess shell



\---



\### 2.2 Route 분리



예:



\* /counter/\*

\* /manager/\*

\* /me/\*



또는:



\* app/(counter)/\*

\* app/(manager)/\*

\* app/(staff)/\*



\---



\### 2.3 화면/기능 분리



\#### 카운터



\* 방 상태

\* 세션 관리

\* 주문

\* 전체 정산

\* 실장 정산 분배



\#### 실장



\* 담당 아가씨 관리

\* 개인 정산

\* 라인 수익

\* 배정



\#### 아가씨



\* 본인 세션

\* 본인 정산

\* 본인 상태



\---



\### 2.4 메뉴 노출 분리



회원가입 / 로그인 이후

role / membership 기반으로 메뉴 노출 분기



\---



\## 3. 금지되는 분리 (FORBIDDEN)



\### 3.1 도메인 분리 금지



\* session 구조 분리 ❌

\* settlement 계산 분리 ❌

\* room identity 분리 ❌

\* store scope 분리 ❌



\---



\### 3.2 API 분열 금지



\* 역할별 다른 계산 로직 ❌

\* 역할별 다른 auth 해석 ❌



\---



\### 3.3 DB 분리 금지



\* 실장 전용 테이블 ❌

\* 아가씨 전용 정산 테이블 ❌



\---



\### 3.4 계산식 분리 금지



정산은 항상 하나의 기준으로 계산되고

역할별로 “보는 값만 다름”



\---



\## 4. 권한/노출 규칙



\### 4.1 회원가입 → membership 생성



\* store\_uuid 연결

\* role 결정

\* 상태 (pending / approved 등)



\---



\### 4.2 로그인 후 접근



| 역할              | 접근     |

| --------------- | ------ |

| counter / owner | 카운터 전체 |

| manager         | 실장 영역  |

| hostess         | 개인 영역  |



\---



\### 4.3 이중 보호 (필수)



\* UI 메뉴 숨김

\* API 권한 차단



둘 중 하나만 하면 실패



\---



\## 5. 상용화 전략 (CRITICAL)



\### 5.1 출시 순서 허용



\* 1차: 실장 웹

\* 2차: 아가씨 웹

\* 3차: 카운터 웹



문제 없음



\---



\### 5.2 하지만 반드시 유지



\* backend는 처음부터 통합 구조

\* settlement 계산은 처음부터 공통

\* session 구조 공통



“나중에 붙인다” 금지



\---



\## 6. 핵심 설계 원칙



\### 원칙 1



카운터 / 실장 / 아가씨는

다른 시스템이 아니라 다른 관점이다



\---



\### 원칙 2



데이터는 하나, 뷰만 다르다



\---



\### 원칙 3



권한은 UI가 아니라 authContext에서 결정된다



\---



\### 원칙 4



카운터를 숨길 수는 있지만

카운터 도메인을 미루면 안 된다



\---



\## 7. 실패 패턴 (절대 금지)



\* 실장 전용 정산 로직 따로 구현

\* 아가씨 전용 데이터 따로 저장

\* 카운터 없이 실장 기준으로만 구조 설계

\* role마다 다른 identity 기준 사용

\* UI에서만 권한 막고 API 열어둠



이 중 하나라도 나오면 구조 붕괴



\---



\## 8. 최종 정의



NOX는:



하나의 정산/세션 시스템 위에

역할별 UI shell이 얹힌 구조다



\---



\## 9. 한 줄 요약 (LOCKED)



분리는 UI만 한다.

시스템은 절대 하나다.



