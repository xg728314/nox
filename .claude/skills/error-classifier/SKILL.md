---
name: error-classifier
description: NOX 오류 발생 시 도메인/런타임/UI 3분류 판정 후 대응 방침 결정
---

# Error Classifier

에러/버그 리포트 받을 때 반드시 실행. 무작정 fix 하지 말고 아래 분류 먼저.

## 1. 도메인 규칙 위반 (즉시 reject + 사유 명시)

다음 시그니처 발견 시 무조건 이 카테고리:
- `store_uuid` 누락 (WHERE 절 없음)
- numeric `store_id` 사용
- `room_no` 를 식별자로 사용
- `membership_id` 없이 인원 scope
- `deleted_at IS NULL` 누락 (해당 테이블만)
- 클라이언트 계산으로 정산 확정 시도
- `user_id` 로 인가 판단

**대응**: 코드 수정 거부 · CLAUDE.md 규칙 인용 · 재설계 요구

## 2. 런타임 오류 (fallback + 원인 보고)

- Supabase 응답 `error.code`
  - `42P01` — 테이블 미존재 (migration 미apply). 응답 503 `MIGRATION_PENDING`
  - `42703` — 컬럼 미존재 (migration 미apply). fallback query 로 재시도
  - `23505` — UNIQUE 위반. duplicate detection · 409 반환
  - `23503` — FK 위반. 원인 (참조 대상 부재) 사용자에 명시
- Network / timeout — retry 1회 후 실패 시 사용자 notice
- Auth 만료 — 재로그인 유도

**대응**: fallback / retry / 사용자 friendly message. 코드 수정은 이 시그니처 대응 로직 추가.

## 3. UI 오류 (해당 상태만 수정)

- 렌더링 오류 (undefined access)
- 상태 누락 (loading/empty/error case)
- CSS purge / dark mode 미대응
- SW 캐시 stale (참고: R-zombie-sw fix 2026-08-23)

**대응**: 좁은 scope 수정. state guard 추가 · optional chaining · fallback UI.

## 판정 시 반드시 확인

1. **서버 로그 실측** — DevTools 400 이 실제 서버 400 이라는 보장 없음
   ```bash
   gcloud run services logs read nox --region=asia-northeast3 --limit=30 \
     | grep -iE "error|400|500"
   ```
2. **Service Worker 상태** — 옛 SW 가 fetch intercept 하는지 (2026-08-23 zombie 사례)
3. **Migration apply 상태** — `mcp__supabase__list_migrations` 로 실 DB 확인

## Anti-pattern

- ❌ "고쳤어" 하고 재현 안 해봄
- ❌ 로그 안 보고 코드 추측
- ❌ 도메인 규칙 위반인데 예외로 우회 (규칙 자체 수정 시 orchestration 승인 필요)
