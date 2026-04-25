# NOX DB Baseline — 2026-04-24

**생성**: Round 4 (2026-04-24)  
**Supabase project**: `piboecawkeqahyqbcize` (nox, ACTIVE_HEALTHY)  
**목적**: 현 DB 상태 **완전 스냅샷** + **신규 환경 재생성 가이드**

---

## 📌 핵심 원칙

**hand-craft 한 SQL 로 재생성하지 마세요.** Supabase 가 공식 제공하는 도구 사용.

### 정석 재생성 절차 (권장)

```bash
# 1. Supabase CLI 설치
npm install -g supabase

# 2. 현재 live DB 스냅샷을 local 로 pull
supabase db pull \
  --db-url "postgresql://postgres:<PASSWORD>@db.piboecawkeqahyqbcize.supabase.co:5432/postgres" \
  --schema public,auth

# → supabase/migrations/<timestamp>_remote_schema.sql 생성됨
# 이 파일이 진짜 baseline. 이걸로 신규 프로젝트 재생성 가능.

# 3. 신규 Supabase 프로젝트 생성 후 apply
supabase db push --db-url <new-project-url>
```

### 정석 방법이 아닌 경우 (본 디렉터리 사용)
- **수동 확인 / 참조용**: 어떤 테이블이 있고, 어떤 제약이 걸려있고, 어떤 인덱스가 있는지 파일로 확인하고 싶을 때.
- **부분 재생성**: 특정 제약/인덱스만 복제하고 싶을 때.

---

## 📂 파일 구성

| 파일 | 내용 |
|---|---|
| `README.md` | 본 문서 — 가이드 |
| `STATE.md` | 현 DB 전체 상태 스냅샷 (markdown, 읽기용) |
| `02_constraints.sql` | 모든 CHECK / FK / UNIQUE 제약 (ALTER TABLE) |
| `03_indexes.sql` | 모든 인덱스 (CREATE INDEX) |
| `04_functions.txt` | 모든 RPC 시그니처 목록 (본문은 `pg_get_functiondef` 로 추출) |
| `05_triggers.txt` | 모든 트리거 목록 |
| `06_rls_policies.txt` | RLS 정책 목록 |

**주의**: `01_tables.sql` 은 의도적으로 **생성하지 않음**.  
이유: 65개 테이블 × 평균 15 컬럼의 CREATE TABLE 을 hand-craft 하면 에러 확률 높음. `supabase db pull` 이 훨씬 정확.

---

## 📊 현재 상태 요약 (2026-04-24 실사)

| 항목 | 수치 |
|---|---|
| Public 테이블 | **65** |
| RPC 함수 | **37** |
| CHECK 제약 | 61 |
| FK 제약 | 약 140 |
| UNIQUE 제약 | 약 30 |
| 인덱스 (PK 제외) | **138** |
| 트리거 | 17 |
| RLS 활성 테이블 | 24 |
| RLS 정책 | 70 |

---

## 🔄 변경 이력

- **2026-04-24 (Round 4)**: 최초 baseline 생성. Round 1-3 완료 상태의 스냅샷.
