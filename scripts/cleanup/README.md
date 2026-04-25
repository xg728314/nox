# NOX 실전 투입 전 NUKE — 단순 2단계

`xg728314@gmail.com` **1개만 보존**, 그 외 모든 데이터 삭제.

## 절차 (2단계, 단순)

### Step 1 — DB 데이터 정리 (Supabase SQL Editor)

1. Supabase Dashboard → **SQL Editor** → New query
2. `scripts/cleanup/NUKE.sql` 전체 복사 → 붙여넣기 → **Run**
3. 결과창의 NOTICE 메시지 확인:
   ```
   ✓ KEEP user_id: ...
   participant_time_segments: -N
   session_participants: -N
   orders: -N
   hostesses: -N
   managers: -N
   store_memberships: -N
   profiles: -N
   ...
   ✓ profiles 잔여: 1
   ✓ store_memberships 잔여: 1
   ```
4. 잔여 카운트가 1 (또는 운영자 보유한 매장 수만큼) 이면 OK.

⚠️ **트랜잭션 자동 적용**. 중간 실패하면 전체 롤백 → 부분 삭제 위험 0.

### Step 2 — auth.users 정리 (Node 스크립트)

Supabase auth.users 는 SQL 직접 못 건드림 → Admin API 필요:

```powershell
$env:NEXT_PUBLIC_SUPABASE_URL = "https://xxx.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "eyJ..."

# dry-run 먼저
npx tsx scripts/cleanup/delete-auth-users.ts

# 실제 삭제
npx tsx scripts/cleanup/delete-auth-users.ts --apply
```

## 검증 (Step 1, 2 모두 끝난 후)

Supabase SQL Editor:
```sql
SELECT count(*) FROM auth.users;            -- 1
SELECT email FROM auth.users;                -- xg728314@gmail.com

SELECT count(*) FROM profiles;               -- 1
SELECT count(*) FROM store_memberships;      -- 운영자 보유 매장 수
SELECT count(*) FROM hostesses;              -- 0
SELECT count(*) FROM managers;               -- 0
SELECT count(*) FROM session_participants;   -- 0
SELECT count(*) FROM orders;                 -- 0
SELECT count(*) FROM cross_store_work_records; -- 0
```

브라우저:
- `/admin/members` → 1건만
- `/staff` → 데이터 없음
- `/counter` → 빈 방만

## 안전 체크리스트

- [ ] Supabase URL **production** 인지 재확인
- [ ] xg728314@gmail.com 으로 **현재 로그인 가능**한가
- [ ] **MFA backup codes 발급 받았는가** (`/me/security`)
- [ ] PITR 시점 메모 (사고 시 복구 기준점)

## 사고 복구

Supabase PITR (Pro plan):
1. Dashboard → Database → Backups → "Restore to a point in time"
2. NUKE.sql 실행 직전 시점 선택 → 새 프로젝트로 복원

## 폐기된 파일들

기존 `cleanup-test-accounts.ts`, `PREVIEW.sql` 은 더 이상 사용 X.
**NUKE.sql + delete-auth-users.ts 만 사용.**

## FAQ

**Q. NUKE.sql 실행 중 에러 나면?**
→ DO 블록이 자동 ROLLBACK. 데이터 손상 0.

**Q. 운영자가 hostess/manager 인 경우?**
→ 현재 NUKE.sql 은 hostesses/managers 테이블 전체 삭제. 운영자 계정에 hostess/manager 정체성이 필요하면 정리 후 `/admin/members/create` 로 다시 등록.

**Q. 매장(stores) 이 모두 사라지면?**
→ 운영자 소속 매장은 보존됨. 운영자가 어느 매장 owner/manager 인지 미리 확인.
