---
name: paper-ledger-recon
description: NOX 종이장부 대조 (Claude Vision) 코드 작성 시 SUM-anchored 매칭 · symbol 사전 · ANTHROPIC_API_KEY 전제 규칙
---

# Paper Ledger Reconciliation

종이장부 사진 ↔ NOX 온라인 장부 자동 대조. R27~R30 완료.

## 핵심 전략: SUM-anchored Reconciliation

**원칙**: 셀 단위 OCR 정확도에 의존하지 않는다.
**대신**: **줄돈/받돈 합계** 가 일치하는지 본다.

- 합계 일치 → 그날 OK · 개별 셀 오차 무시
- 합계 불일치 → owner 리뷰 필요

## 파일 구조

- `lib/reconcile/types.ts` — 도메인 타입
- `lib/reconcile/symbols.ts` — 심볼 사전 (매장 공통 default)
- `lib/reconcile/prompts.ts` — Claude Vision 프롬프트
- `lib/reconcile/extract.ts` — 이미지 → 구조화 데이터
- `lib/reconcile/paperTotals.ts` — 종이 합계 계산
- `lib/reconcile/dbAggregate.ts` — DB 합계 계산
- `lib/reconcile/match.ts` — 매칭 판정
- `lib/reconcile/matchStaff.ts` — 스태프별 매칭
- `lib/reconcile/qualityHints.ts` — 화질/기울기 힌트
- `lib/reconcile/validateExtraction.ts` — 추출 결과 검증
- `lib/reconcile/parseText.ts` — 텍스트 파싱
- `lib/reconcile/managerLedgerFromPaper.ts` — 매니저 장부 변환
- `lib/reconcile/computePayout.ts` — 지급액 계산
- `lib/reconcile/deleteCascade.ts` — cascade 삭제

## 심볼 사전 (default)

- `★` = 셔츠
- 빨간 동그라미 = 차3
- 동그라미 2겹 = 반차3
- `(완)` = 완티
- `(반)` = 반티
- `(반차3)` / `(빵3)` = 반차3
- 한자 `一` / `ㅡ` = 1
- 한자 `二` / `ㅜ` = 2
- 시간 뒤 `S` = 셔츠
- "이름·매장" → hostess_name + origin_store

## unknown token 학습 흐름

- 추출 시 모르는 심볼 → `unknown_tokens` 배열에 적재
- owner 가 `/reconcile/setup` 페이지에서 등록
- 다음 대조부터 반영

## 환경 변수

- `ANTHROPIC_API_KEY` 필요 (Claude Vision)
- 미설정 시 자동 추출 비활성 · 사진 보관/수동 리뷰는 동작

## 비용

- 페이지당 ~$0.003
- 14매장 × 2장 × 30일 ≈ **$2.5/월**

## API routes

- `POST /api/reconcile/upload` — 사진 업로드
- `GET /api/reconcile/list` — 목록
- `GET /api/reconcile/[id]` — 상세
- `POST /api/reconcile/[id]/extract` — Vision 추출
- `GET /api/reconcile/[id]/diff` — DB 대조 결과
- `POST /api/reconcile/[id]/review` — owner 리뷰
- `POST /api/reconcile/format` — 심볼 사전 관리

## 스토리지

- `lib/storage/paperLedgerBucket.ts` — Supabase Storage 헬퍼
- Bucket: 종이장부 사진 저장 (RLS 적용 · 매장별 스코프)

## 자주 하는 실수

- ❌ 셀 단위 정확도 높이려고 프롬프트 튜닝 → SUM-anchored 원칙 위배
- ❌ ANTHROPIC_API_KEY 없이 자동 추출 시도 → silent fail
- ❌ unknown_tokens 무시하고 파싱 진행 → owner 리뷰 놓침
- ❌ 매장별 커스텀 심볼 default 로 밀어넣음 → 매장 오분류

## 체크리스트

- [ ] SUM 기준 매칭 (셀 단위 X)
- [ ] ANTHROPIC_API_KEY 환경 확인
- [ ] unknown_tokens 배열 관리
- [ ] `paperLedgerBucket` 헬퍼 재사용
- [ ] cron `paper-ledger-expire` 로 오래된 사진 정리
