# NOX Hand-off

외부 개발자가 NOX 모바일 어플을 동일하게 만들 수 있도록 페이지별 spec
(UI + API + DB + 동작 흐름) + 자동 스크린샷 을 제공.

## 접근

```
https://nox.ai.kr/handoff
```

**권한**: super_admin 만 접근 가능. 그 외 → /m 으로 redirect.

## 구성

```
handoff/
├── README.md           # 이 파일
└── data/
    ├── pages.json      # 자동 추출 (scripts/generate-handoff-data.mjs)
    │                   #   각 페이지 — 라우트, 호출 API, DB 테이블, 컴포넌트
    └── pages-meta.json # 수동 보강 — UI 설명 / 흐름 / 권한 / 엣지 케이스

scripts/
├── generate-handoff-data.mjs       # 코드 → JSON 자동 분석
└── capture-handoff-screenshots.mjs # Playwright 자동 캡쳐

app/handoff/
├── layout.tsx        # 배경 + 폰트
├── page.tsx          # 인덱스 — 카테고리별 카드 그리드
└── page/
    └── page.tsx      # 페이지 상세 — UI / API / DB / 흐름

public/handoff/screens/  # Playwright 출력 (gitignored 권장)
```

## 사용

### 1. 데이터 갱신 (코드 변경 후)

```bash
node scripts/generate-handoff-data.mjs
```

`handoff/data/pages.json` 재생성 — 페이지 17개, API 301개, DB 테이블 89개 분석.

### 2. UI 설명 보강

`handoff/data/pages-meta.json` 편집:

```json
{
  "pages": {
    "/m/staff": {
      "title": "스태프 목록",
      "category": "스태프",
      "summary": "...",
      "ui_flow": ["1. ...", "2. ..."],
      "permissions": "owner / manager",
      "edge_cases": ["..."]
    }
  }
}
```

### 3. 스크린샷 캡쳐

```bash
# 최초 1회 — Playwright 설치
npm i -D playwright
npx playwright install chromium

# 캡쳐 실행
BASE_URL=https://nox.ai.kr ACCESS_TOKEN=<sb-access-token> node scripts/capture-handoff-screenshots.mjs
```

토큰 획득:
- 브라우저 로그인 → DevTools → Application → Cookies → `sb-access-token` 값 복사
- super_admin 계정 권장 (모든 페이지 접근 가능)

출력: `public/handoff/screens/{route_slug}.png`

### 4. 배포

`/handoff` 라우트가 자동으로 데이터 + 스크린샷 표시.

## 페이지 카테고리

- **홈** — 대시보드 (`/m`)
- **스태프** — 식구 list / 상세 / 출근 / 사전등록 / 규칙
- **메이드 등록** — 4-step 배정 (`/m/assign`)
- **채팅** — 매장 전체 / 그룹 / DM / 룸 채팅
- **정산** — 식구별 정산 (정산완료/보관/팁) + cross-store
- **매장** — 상세 / 종목 단가 / 운영 설정
- **관제** — super_admin 전용 (5-8F 매장 모니터링)
- **내정보** — 프로필 / 보안 / 로그아웃

## 외부 개발자에게 줄 자료

1. **이 README** — 시작 가이드
2. `/handoff` URL — 인터랙티브 spec (페이지별 카드 → 상세)
3. `database/*.sql` — DB 스키마 (LOCKED docs 제외)
4. `CLAUDE.md` — 비즈니스 규칙 + 도메인 어휘
5. API 응답 예시 — 각 페이지 detail 에서 호출 API list 참고

## 향후 확장

- API 응답 schema 자동 추출 (Zod / TypeBox)
- DB ERD 자동 생성 (pg_dump → mermaid)
- Sequence diagram (페이지 → API → DB 흐름)
- 다국어 (영문 spec)
