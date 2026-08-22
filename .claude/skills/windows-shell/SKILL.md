---
name: windows-shell
description: NOX 개발 환경 (Windows 11 · Git Bash + PowerShell · Cloud Run + Cloud Build · gcloud) 명령어 차이 · 함정 회피 규칙
---

# Windows Shell

NOX 는 Windows 11 에서 개발. Bash 와 PowerShell 문법 차이 주의.

## 쉘 선택

- **Bash 도구** = Git Bash (POSIX sh). Unix 명령 그대로.
- **PowerShell 도구** = Windows PowerShell 5.1. 문법 다름.

## 자주 하는 실수

### Bash 에서 PowerShell 문법 쓰기

PowerShell here-string `@' ... '@` 는 Bash 에서 파싱 안 됨. 앞에 `@` 문자가 커밋 메시지에 붙어버림.

- ❌ Bash 에서 `git commit -m @'...'@` — 파싱 실패
- ✅ 파일로 저장 후 `-F` 로 넘김:
  ```bash
  cat > /tmp/msg.txt <<< "first line"
  git commit -F /tmp/msg.txt
  ```

### 중첩 heredoc 함정

Bash heredoc 안에 또 다른 heredoc 예시 쓰면 파서 혼란. 실제로 이 skill 파일 작성 중 발생 → Write tool 로 fallback 필요.

### PowerShell 에서 Bash 문법 쓰기

- ❌ `npm install && npm run build` — PS 5.1 파이프 chain `&&` 없음 (파서 에러)
- ✅ `npm install; if ($?) { npm run build }`

### 파일 경로

- Bash 에서는 forward slash: `C:/work/nox/lib/...`
- PowerShell 에서는 backslash 도 OK: `C:\work\nox\lib\...`
- JSON / config 안에서는 POSIX 스타일 권장 (crossplatform)

## Cloud Run 명령어 (gcloud CLI 필요)

서비스 로그 실측 (pattern-dispatch 400 이슈 같은 진단):
```bash
gcloud run services logs read nox --region=asia-northeast3 --limit=30
```

최신 revision 확인:
```bash
gcloud run services describe nox --region=asia-northeast3 --format="value(status.latestReadyRevisionName)"
```

트래픽 상태:
```bash
gcloud run services describe nox --region=asia-northeast3 --format="yaml(status.traffic)"
```

## Cloud Build 상태 확인

최신 빌드:
```bash
gcloud builds list --limit=5 --format="table(id,status,createTime,duration)"
```

특정 빌드 상세:
```bash
gcloud builds describe <BUILD_ID> --format="value(status,logUrl)"
```

## Supabase MCP tool

- `mcp__supabase__list_migrations` — 실 apply 확인
- `mcp__supabase__execute_sql` — read-only SQL
- `mcp__supabase__apply_migration` — DDL 적용 (careful)

## Environment

- **Node**: `.nvmrc` 있으면 그 버전, 없으면 최신 LTS
- **npm scripts**: `npm run dev`, `npm run build`, `npm run lint`
- **Python E2E**: `python scripts/test-*.py`
- **Seed**: `npx tsx scripts/seed-test-data.ts`

## 배포 흐름

```
git push origin main
  → Cloud Build 트리거 (cloudbuild.yaml)
  → Docker image → Artifact Registry
  → Cloud Run 새 revision 배포
  → 자동 traffic 100% 전환
```

- **소요 시간**: 평균 5~7분
- **모니터링**: `gcloud builds list` · Monitor tool 로 completion watch

## 자주 하는 실수 요약

- ❌ Bash 에서 PowerShell here-string 시도 → 앞에 `@` 문자 붙음
- ❌ PowerShell 에서 `&&` 사용 → 파서 에러
- ❌ 파일 경로에 특수문자 · 공백 있을 때 quote 안 함
- ❌ `Set-Content` UTF-8 없이 씀 → BOM 없이 ANSI 로 저장 → 다른 툴이 못 읽음
- ❌ `gcloud` 인증 안 됐는데 명령 실행 → 조용히 실패
- ❌ Bash 안에 중첩 heredoc — 파서 혼란

## 체크리스트

- [ ] Bash / PowerShell 문법 혼용 안 함
- [ ] 파일 경로 quote (공백 대비)
- [ ] gcloud 명령 실행 전 `gcloud auth list` 확인
- [ ] 커밋 메시지 heredoc 은 파일로 저장 후 `-F` 로 넘김
- [ ] PowerShell 에서 pipe chain 시 `; if ($?) {...}` 사용
- [ ] 중첩 heredoc 필요하면 Write tool 로 fallback
